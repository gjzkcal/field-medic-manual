// 原稿の検査。content/manuals/ の原稿を直したら `pnpm test` で確かめる。
// アプリと同じ bundle.ts（import.meta.glob）から読むので、同梱のされ方も一緒に確かめられる。
import { describe, expect, it } from "vitest";

import { bundledManuals, readBundledData } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { resolveLink } from "@/features/library/link";
import { readRepoFile } from "@/test/samples";

const manuals = await bundledManuals();
const converted = await Promise.all(
  manuals.map(async (manual) => ({ manual, ...(await convertManual(manual, readRepoFile, readBundledData)) })),
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
        "リンク切れです。他の原稿へは content/manuals/ のファイル名と見出しのアンカー（例: hemorrhage.md#止血帯を使う）、同じ原稿の中は #アンカー で書きます",
      ).toEqual([]);
    },
  );

  it("すべてに order があり、重複しない（ライブラリと見出しツリーの並び順）", () => {
    const missing = converted.filter((c) => c.doc.meta.order === null).map((c) => c.manual.fileName);
    expect(missing, "front matter の order を書いてください").toEqual([]);
    const orders = converted.map((c) => c.doc.meta.order);
    expect(new Set(orders).size, "order が重複しています").toBe(orders.length);
  });

  it("「この原稿の読み方」の「原稿の一覧」の表は order の順に並んでいる", () => {
    const about = converted.find((c) => c.manual.fileName === "about-this-manual.md");
    const section = about?.doc.sections.find((s) => s.title === "原稿の一覧");
    expect(section, "about-this-manual.md に「原稿の一覧」の節がありません").toBeDefined();
    const container = document.createElement("div");
    container.innerHTML = section?.html ?? "";
    const listed = Array.from(container.querySelectorAll("table a[href]")).map((a) => {
      const link = resolveLink(a.getAttribute("href") ?? "");
      return link.kind === "doc" ? link.fileName : a.getAttribute("href");
    });
    const byOrder = [...converted]
      .sort((a, b) => (a.doc.meta.order ?? Infinity) - (b.doc.meta.order ?? Infinity))
      .map((c) => c.manual.fileName);
    expect(listed, "表の並びと order の順を合わせてください").toEqual(byOrder);
  });

  it("ファイル名は英小文字・数字・ハイフンだけ（sourcePath とリンクに使うため）", () => {
    for (const m of manuals) {
      expect(m.fileName).toMatch(/^[a-z0-9-]+\.md$/);
    }
  });
});
