// フローの原稿の検査。content/flows/ のフローを直したら `pnpm test` で確かめる。
// アプリと同じ bundle.ts（import.meta.glob）から読むので、同梱のされ方も一緒に確かめられる。
import { describe, expect, it } from "vitest";

import { bundledFlows, flowIdOfFileName, readFlowSource } from "@/features/triage/bundle";
import { parseFlowLink } from "@/features/triage/links";
import type { Flow } from "@/features/triage/schema";
import { validateFlows } from "@/features/triage/validate";
import { linkTargetExists, loadLinkTargets } from "@/test/content-links";

const sources = await bundledFlows();
const read = await Promise.all(
  sources.map(async (source) => ({ source, result: await readFlowSource(source) })),
);
const flows: Flow[] = read.flatMap(({ result }) => (result.ok ? [result.flow] : []));
const issuesById = new Map(validateFlows(flows).map((issues, i) => [flows[i]?.id, issues]));

const targets = await loadLinkTargets();

describe("同梱したフロー", () => {
  it("1 つ以上ある", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(read.map((r) => [r.source.fileName, r] as const))(
    "%s: 形が正しく、ファイル名が <id>.flow.yaml|json",
    (fileName, { result }) => {
      expect(result.ok ? [] : result.messages).toEqual([]);
      expect(result.ok && flowIdOfFileName(fileName)).toBe(result.ok && result.flow.id);
    },
  );

  it.each(flows.map((flow) => [flow.id, flow] as const))(
    "%s: V1〜V8 でエラーがない（再評価のループ V6 の警告だけは許す）",
    (id, flow) => {
      const issues = (issuesById.get(id) ?? []).filter((i) => i.code !== "V6");
      expect(issues.map((i) => `${i.code}: ${i.message}`)).toEqual([]);
      expect(flow.modTarget?.length ?? 0, "modTarget を書いてください").toBeGreaterThan(0);
      expect(flow.verifiedAt, "verifiedAt を書いてください").toBeDefined();
    },
  );

  it.each(flows.map((flow) => [flow.id, flow] as const))(
    "%s: 物品を使う処置には、持っていないときの行き先（ifMissing）がある",
    (_, flow) => {
      const missing = Object.entries(flow.nodes)
        .filter(
          ([, node]) =>
            node.type === "action" && (node.items?.length ?? 0) > 0 && node.ifMissing === undefined,
        )
        .map(([id]) => id);
      expect(
        missing,
        "現場で物品が足りなくてもフローが止まらないよう、ifMissing: { next: ... } を書いてください",
      ).toEqual([]);
    },
  );

  it.each(flows.map((flow) => [flow.id, flow] as const))(
    "%s: リンクの行き先（マニュアルのファイルとアンカー、フロー、クイック表の行）がある",
    (_, flow) => {
      const broken: string[] = [];
      for (const node of Object.values(flow.nodes)) {
        const links = node.type === "action" || node.type === "end" ? (node.links ?? []) : [];
        broken.push(...links.filter((text) => !linkTargetExists(parseFlowLink(text), targets)));
      }
      expect(
        broken,
        "リンク切れです。doc: は content/manuals/ のファイル名と見出しのアンカー（例 doc:hemorrhage.md#止血帯を使う）、quickref: は content/quickref.yaml の行の id",
      ).toEqual([]);
    },
  );
});
