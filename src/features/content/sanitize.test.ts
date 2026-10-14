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

  it("SVG は許さない", () => {
    expect(sanitizeHtml('<p>a<svg><circle r="1"></circle></svg></p>').html).toBe("<p>a</p>");
  });
});
