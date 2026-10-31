import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "@/features/content/sanitize";

describe("sanitizeHtml", () => {
  it("画像・グラフ・表の列の条件の data 属性だけを残す", () => {
    const { html } = sanitizeHtml(
      '<table data-chart="{&quot;x&quot;:&quot;経過&quot;}" data-mod-columns="[]" data-foo="1"><tbody><tr><td>1</td></tr></tbody></table><img data-asset-id="abc" data-bar="2">',
    );
    expect(html).toBe(
      '<table data-chart="{&quot;x&quot;:&quot;経過&quot;}" data-mod-columns="[]"><tbody><tr><td>1</td></tr></tbody></table><img data-asset-id="abc">',
    );
  });

  it("式の MathML は残し、その中の script・style・リンク・イベントは落とす", () => {
    const { html } = sanitizeHtml(
      [
        '<div class="manual-math"><math display="block" class="tml-display" style="display:block math;">',
        '<mrow><mi href="javascript:alert(1)">x</mi><mo fence="true" form="prefix" onclick="x()">(</mo>',
        '<mfrac><mn>1</mn><mn>2</mn></mfrac><mspace width="0.2em"></mspace>',
        "<script>alert(1)</script></mrow></math></div>",
      ].join(""),
    );
    expect(html).toBe(
      [
        '<div class="manual-math"><math display="block" class="tml-display">',
        '<mrow><mi>x</mi><mo fence="true">(</mo>',
        '<mfrac><mn>1</mn><mn>2</mn></mfrac><mspace width="0.2em"></mspace>',
        "</mrow></math></div>",
      ].join(""),
    );
  });

  it("MathML の要素の href は https でも落とし、ふつうのリンクの href は残す", () => {
    const { html } = sanitizeHtml(
      [
        '<p><a href="https://example.com/">リンク</a></p>',
        '<math><mrow href="https://example.com/"><mi xlink:href="https://example.com/">x</mi></mrow></math>',
      ].join(""),
    );
    expect(html).toBe(
      '<p><a href="https://example.com/">リンク</a></p><math><mrow><mi>x</mi></mrow></math>',
    );
  });

  it("フローチャートの figure は印と題と文のリストを残す", () => {
    const html =
      '<figure data-flowchart="{&quot;direction&quot;:&quot;TB&quot;}" aria-label="流れ"><ul class="manual-flowchart-text"><li>A → B</li></ul></figure>';
    expect(sanitizeHtml(html).html).toBe(html);
  });

  it("SVG は許さない", () => {
    expect(sanitizeHtml('<p>a<svg><circle r="1"></circle></svg></p>').html).toBe("<p>a</p>");
  });

  it("リンクは http・https と相対パスだけを残す", () => {
    for (const href of [
      "https://example.com/",
      "http://example.com/",
      "hemorrhage.md#止血帯を使う",
      "./airway-breathing2.md",
      "#節",
    ]) {
      expect(sanitizeHtml(`<a href="${href}">x</a>`).html).toBe(`<a href="${href}">x</a>`);
    }
    for (const href of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///C:/a",
      "mailto:a@example.com",
      "tel:0",
      "sms:0",
      "ftp://example.com/",
    ]) {
      expect(sanitizeHtml(`<a href="${href}">x</a>`).html).toBe("<a>x</a>");
    }
  });

  it("map と area は許さない", () => {
    expect(
      sanitizeHtml('<map name="m"><area href="https://example.com/"></map><p>本文</p>').html,
    ).toBe("<p>本文</p>");
  });
});
