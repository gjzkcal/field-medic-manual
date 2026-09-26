import { describe, expect, it } from "vitest";

import { findTextRanges, paintSearchHighlight } from "@/features/search/highlight";

function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  return el;
}

describe("findTextRanges", () => {
  it("要素の中の文字列から、すべての出現箇所を探す", () => {
    const root = article("<h2>止血帯を使う</h2><p>止血帯は<strong>止血帯</strong>。</p>");
    expect(findTextRanges(root, ["止血帯"]).map(String)).toEqual(["止血帯", "止血帯", "止血帯"]);
  });

  it("大文字小文字を無視し、複数の語を探す", () => {
    const root = article("<p>CPR と cpr と TQ</p>");
    expect(findTextRanges(root, ["cpr", "tq"]).map(String)).toEqual(["CPR", "cpr", "TQ"]);
  });

  it("空の語や重複は無視する", () => {
    const root = article("<p>止血</p>");
    expect(findTextRanges(root, ["", " ", "止血", "止血"])).toHaveLength(1);
    expect(findTextRanges(root, [])).toEqual([]);
  });
});

describe("paintSearchHighlight", () => {
  it("Highlight API のない環境では何もせず、消す関数を返す", () => {
    const root = article("<p>止血</p>");
    const clear = paintSearchHighlight(findTextRanges(root, ["止血"]));
    expect(() => {
      clear();
    }).not.toThrow();
  });
});
