// クイック表の原稿の検査。content/quickref.yaml を直したら `pnpm test` で確かめる。
// アプリと同じ bundle.ts（import.meta.glob）から読むので、同梱のされ方も一緒に確かめられる。
import { describe, expect, it } from "vitest";

import { meetsModConditions } from "@/features/settings/mod-conditions";
import { bundledQuickref, readQuickrefSource } from "@/features/quickref/bundle";
import { activeMods, SELECTABLE_MODS, type SelectableMod } from "@/features/settings/mod-settings";
import { parseFlowLink } from "@/features/triage/links";
import { linkTargetExists, loadLinkTargets } from "@/test/content-links";

const source = await bundledQuickref();
const read = source === null ? null : await readQuickrefSource(source);
const rows = read?.ok === true ? read.file.rows : [];
const targets = await loadLinkTargets();

/** 設定で選べる MOD のすべての組み合わせ（16 通り） */
function allCombinations(): SelectableMod[][] {
  return Array.from({ length: 2 ** SELECTABLE_MODS.length }, (_, bits) =>
    SELECTABLE_MODS.filter((_, i) => (bits & (1 << i)) !== 0),
  );
}

describe("同梱したクイック表", () => {
  it("content/quickref.yaml があり、形が正しい（UTF-8・BOM なし、必須項目、重症度、id の重複など）", () => {
    expect(source, "content/quickref.yaml がありません").not.toBeNull();
    expect(read?.ok === false ? read.messages : []).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(rows.map((row) => [row.id, row] as const))(
    "%s: 根拠の原稿の節（doc:）へのリンクがあり、リンクの行き先がある",
    (_, row) => {
      const links = row.links.map((text) => ({ text, link: parseFlowLink(text) }));
      expect(
        links.some(({ link }) => link?.kind === "doc"),
        "どの原稿の事実に基づくかを追えるよう、doc:<ファイル名>#<アンカー> を 1 つ以上書いてください",
      ).toBe(true);
      expect(
        links.filter(({ link }) => !linkTargetExists(link, targets)).map(({ text }) => text),
        "リンク切れです。doc: は content/manuals/ のファイル名と見出しのアンカー、flow: はフローの id、quickref: は行の id",
      ).toEqual([]);
    },
  );

  it("使っている MOD のどの組み合わせでも、同じ症状の行が 2 つ出ない", () => {
    const clashes: string[] = [];
    for (const enabled of allCombinations()) {
      const active = activeMods({ enabled });
      const seen = new Map<string, string>();
      for (const row of rows) {
        const conditions = { mods: row.mods ?? [], withoutMods: row.withoutMods ?? [] };
        if (!meetsModConditions(conditions, active)) {
          continue;
        }
        const other = seen.get(row.symptom);
        if (other !== undefined) {
          clashes.push(`Core${enabled.map((m) => ` + ${m}`).join("")}: ${other} と ${row.id}`);
        }
        seen.set(row.symptom, row.id);
      }
    }
    expect(
      [...new Set(clashes)],
      "同じ MOD の組み合わせで同じ症状の行が 2 つ出ます。mods（すべて入れているとき）と withoutMods（どれも入れていないとき）で出し分けてください",
    ).toEqual([]);
  });
});
