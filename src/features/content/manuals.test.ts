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
function byOrder(): typeof converted {
  return [...converted].sort((a, b) => (a.doc.meta.order ?? Infinity) - (b.doc.meta.order ?? Infinity));
}
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

  // 組み合わせの節の見出しの形。AI キャラの話（### AI の場合）や「Circulation の有無で…」のような入れ物の見出しには当たらない
  const COMBINATION_HEADING = /(?:Hitzones|Circulation|Breathing|AI) *(?:を入れている(?:場合|とき)|なし.*の場合)/;
  // 見出しの形は組み合わせの節だが、中身はどの組み合わせでも読ませたいので条件を付けないもの
  const UNCONDITIONAL_HEADINGS = new Set([
    // あり / なしを比べる表と、組み合わせに関係のない「AI の場合」を含む
    "death-second-chance.md#circulation-を入れているときの結果",
  ]);

  it.each(converted.map((c) => [c.manual.fileName, c] as const))(
    "%s: MOD の組み合わせの見出しには表示条件の印がある",
    (fileName, { doc }) => {
      const missing = doc.sections
        .filter(
          (s) =>
            COMBINATION_HEADING.test(s.title) &&
            s.mods.length === 0 &&
            s.withoutMods.length === 0 &&
            !UNCONDITIONAL_HEADINGS.has(`${fileName}#${s.anchor}`),
        )
        .map((s) => s.title);
      expect(
        missing,
        "見出しの直後に <!-- mods: circulation -->（入れているとき）か <!-- mods: !circulation -->（入れていないとき）を書いてください",
      ).toEqual([]);
    },
  );

  it("すべてに order があり、重複しない（ライブラリと見出しツリーの並び順）", () => {
    const missing = converted.filter((c) => c.doc.meta.order === null).map((c) => c.manual.fileName);
    expect(missing, "front matter の order を書いてください").toEqual([]);
    const orders = converted.map((c) => c.doc.meta.order);
    expect(new Set(orders).size, "order が重複しています").toBe(orders.length);
  });

  it("すべてに category があり、同じ分類は order の上で続けて並ぶ（ライブラリと見出しツリーの分類）", () => {
    const missing = converted.filter((c) => c.doc.meta.category === null).map((c) => c.manual.fileName);
    expect(missing, "front matter の category を書いてください").toEqual([]);
    // 途切れると、後ろの原稿が前の分類の見出しの下へ移り、order の順と画面の並びが食い違う
    const runs = byOrder().map((c) => c.doc.meta.category).filter((c, i, all) => i === 0 || c !== all[i - 1]);
    expect(new Set(runs).size, `同じ分類の原稿の間に別の分類の原稿があります: ${runs.join(" → ")}`).toBe(runs.length);
  });

  it("「この原稿の読み方」の「原稿の一覧」の表は order の順に並び、分類が front matter と合う", () => {
    const about = converted.find((c) => c.manual.fileName === "about-this-manual.md");
    const section = about?.doc.sections.find((s) => s.title === "原稿の一覧");
    expect(section, "about-this-manual.md に「原稿の一覧」の節がありません").toBeDefined();
    const container = document.createElement("div");
    container.innerHTML = section?.html ?? "";
    const headers = Array.from(container.querySelectorAll("table thead th")).map((th) => th.textContent.trim());
    const categoryColumn = headers.indexOf("分類");
    expect(categoryColumn, "表に「分類」の列がありません").toBeGreaterThanOrEqual(0);
    const rows = Array.from(container.querySelectorAll("table tbody tr")).map((tr) => {
      const a = tr.querySelector("a[href]");
      const link = resolveLink(a?.getAttribute("href") ?? "");
      return {
        fileName: link.kind === "doc" ? link.fileName : a?.getAttribute("href"),
        category: tr.children[categoryColumn]?.textContent.trim(),
      };
    });
    const expected = byOrder();
    expect(
      rows.map((r) => r.fileName),
      "表の並びと order の順を合わせてください",
    ).toEqual(expected.map((c) => c.manual.fileName));
    expect(
      rows.map((r) => [r.fileName, r.category]),
      "表の「分類」の列と front matter の category を合わせてください",
    ).toEqual(expected.map((c) => [c.manual.fileName, c.doc.meta.category]));
  });

  it("ファイル名は英小文字・数字・ハイフンだけ（sourcePath とリンクに使うため）", () => {
    for (const m of manuals) {
      expect(m.fileName).toMatch(/^[a-z0-9-]+\.md$/);
    }
  });
});
