import { describe, expect, it } from "vitest";

import { figuresOnly } from "@/features/chat/figures";

describe("figuresOnly", () => {
  it("グラフにする表・図・画像だけを残し、本文の段落は除く", () => {
    const html = [
      "<p>本文</p>",
      '<table data-chart="{}"><tr><td>1</td></tr></table>',
      "<table><tr><td>ただの表</td></tr></table>",
      '<figure data-flowchart="{}"><img data-asset-id="a"></figure>',
      '<p><img data-asset-id="b" alt="図"></p>',
    ].join("");
    const out = figuresOnly(html);
    expect(out).toContain('data-chart="{}"');
    expect(out).toContain("data-flowchart");
    expect(out).toContain('data-asset-id="b"');
    expect(out).not.toContain("本文");
    expect(out).not.toContain("ただの表");
    // figure の中の画像は figure ごと 1 回だけ
    expect(out.match(/data-asset-id="a"/gu)).toHaveLength(1);
  });

  it("図がなければ空", () => {
    expect(figuresOnly("<p>本文だけ</p>")).toBe("");
  });
});
