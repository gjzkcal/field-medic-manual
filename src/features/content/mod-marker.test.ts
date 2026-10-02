import { describe, expect, it } from "vitest";

import { markModColumns, readModColumns } from "@/features/content/mod-marker";

// 文書の先頭のコメントは body の外に置かれるので、原稿と同じく前に段落を置く
function body(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<p>前</p>${html}`, "text/html").body;
}

const TABLE =
  "<table><thead><tr><th>項目</th><th>あり</th><th>なし</th></tr></thead><tbody><tr><td>総量</td><td>750</td><td>1500</td></tr></tbody></table>";

describe("markModColumns", () => {
  it("表の直前の印を列ごとの条件にして表に付け、印を消す", () => {
    const el = body(`<!-- columns: - | circulation, breathing | ！circulation -->\n${TABLE}`);
    const warnings: string[] = [];
    markModColumns(el, warnings);

    expect(warnings).toEqual([]);
    expect(el.innerHTML).not.toContain("<!--");
    const columns = readModColumns(el.querySelector("table")?.getAttribute("data-mod-columns") ?? "");
    expect(columns).toEqual([
      { mods: [], withoutMods: [] },
      { mods: ["circulation", "breathing"], withoutMods: [] },
      { mods: [], withoutMods: ["circulation"] },
    ]);
  });

  it("次が表でない・列の数が合わない・MOD 名の書き間違いを警告し、条件を付けない", () => {
    const el = body(
      [
        "<!-- columns: - | circulation --><p>段落</p>",
        `<!-- columns: - | circulation -->${TABLE}`,
        `<!-- columns: - | circulaton | !circulation -->${TABLE}`,
      ].join(""),
    );
    const warnings: string[] = [];
    markModColumns(el, warnings);

    expect(warnings).toEqual([
      expect.stringContaining("印の次が表ではありません"),
      expect.stringContaining("列の数（2）が表の列の数（3）と合いません"),
      expect.stringContaining("mods の値が不明です: circulaton"),
    ]);
    const marked = Array.from(el.querySelectorAll("table")).map((t) => t.hasAttribute("data-mod-columns"));
    // 書き間違えた MOD は捨てて、残りの条件で付ける（警告で気づける）
    expect(marked).toEqual([false, true]);
  });
});

describe("readModColumns", () => {
  it("形が違えば null", () => {
    expect(readModColumns("not json")).toBeNull();
    expect(readModColumns('[{"mods":["unknown"],"withoutMods":[]}]')).toBeNull();
    expect(readModColumns('[{"mods":[]}]')).toBeNull();
  });
});
