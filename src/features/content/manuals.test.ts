// 原稿の検査。content/manuals/ の原稿を直したら `pnpm test` で確かめる（dev-docs/reference/bundled-content.md §6）。
// アプリと同じ bundle.ts（import.meta.glob）から読むので、同梱のされ方も一緒に確かめられる。
import { describe, expect, it } from "vitest";

import { bundledManuals } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { readRepoFile } from "@/test/samples";

const manuals = await bundledManuals();

describe("同梱した原稿", () => {
  it("1 つ以上ある", () => {
    expect(manuals.length).toBeGreaterThan(0);
  });

  it.each(manuals.map((m) => [m.fileName, m] as const))(
    "%s: 警告なしで変換でき、対象モジュールと確認日が書いてある",
    async (_, manual) => {
      const { doc, warnings } = await convertManual(manual, readRepoFile);
      expect(warnings).toEqual([]);
      expect(doc.meta.modTarget, "front matter の mod を書いてください").not.toBeNull();
      expect(doc.meta.verifiedAt, "front matter の verified_at を書いてください").not.toBeNull();
      expect(doc.sections.length).toBeGreaterThan(0);
    },
  );

  it("ファイル名は英小文字・数字・ハイフンだけ（sourcePath とリンクに使うため）", () => {
    for (const m of manuals) {
      expect(m.fileName).toMatch(/^[a-z0-9-]+\.md$/);
    }
  });
});
