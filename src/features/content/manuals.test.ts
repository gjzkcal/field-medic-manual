// 原稿の検査。content/manuals/ の原稿を直したら `pnpm test` で確かめる（dev-docs/reference/bundled-content.md §6）。
// アプリと同じ bundle.ts（import.meta.glob）から読むので、同梱のされ方も一緒に確かめられる。
import { describe, expect, it } from "vitest";

import { bundledManuals } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { resolveLink } from "@/features/library/link";
import { readRepoFile } from "@/test/samples";

const manuals = await bundledManuals();
const converted = await Promise.all(
  manuals.map(async (manual) => ({ manual, ...(await convertManual(manual, readRepoFile)) })),
);
const anchorsByFile = new Map(
  converted.map(({ manual, doc }) => [manual.fileName, new Set(doc.sections.map((s) => s.anchor))]),
);

describe("同梱した原稿", () => {
  it("1 つ以上ある", () => {
    expect(manuals.length).toBeGreaterThan(0);
  });

  it.each(converted.map((c) => [c.manual.fileName, c] as const))(
    "%s: 警告なしで変換でき、対象モジュールと確認日が書いてある",
    (_, { doc, warnings }) => {
      expect(warnings).toEqual([]);
      expect(doc.meta.modTarget, "front matter の mod を書いてください").not.toBeNull();
      expect(doc.meta.verifiedAt, "front matter の verified_at を書いてください").not.toBeNull();
      expect(doc.sections.length).toBeGreaterThan(0);
    },
  );

  it.each(converted.map((c) => [c.manual.fileName, c] as const))(
    "%s: 内部リンクの行き先（ファイルとアンカー）がある",
    (fileName, { doc }) => {
      const broken: string[] = [];
      for (const section of doc.sections) {
        const container = document.createElement("div");
        container.innerHTML = section.html;
        for (const a of Array.from(container.querySelectorAll("a[href]"))) {
          const href = a.getAttribute("href") ?? "";
          const link = resolveLink(href);
          const ok =
            link.kind === "external" ||
            (link.kind === "anchor" && anchorsByFile.get(fileName)?.has(link.anchor) === true) ||
            (link.kind === "doc" &&
              anchorsByFile.has(link.fileName) &&
              (link.anchor === null || anchorsByFile.get(link.fileName)?.has(link.anchor) === true));
          if (!ok) {
            broken.push(decodeURIComponent(href));
          }
        }
      }
      expect(
        broken,
        "リンク切れです。書き方は dev-docs/reference/content-guide.md §4（例: hemorrhage.md#止血帯を使う）",
      ).toEqual([]);
    },
  );

  it("ファイル名は英小文字・数字・ハイフンだけ（sourcePath とリンクに使うため）", () => {
    for (const m of manuals) {
      expect(m.fileName).toMatch(/^[a-z0-9-]+\.md$/);
    }
  });
});
