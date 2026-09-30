import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "@/features/content/sanitize";

describe("sanitizeHtml", () => {
  it("画像とグラフの data 属性だけを残す", () => {
    const { html } = sanitizeHtml(
      '<table data-chart="{&quot;x&quot;:&quot;経過&quot;}" data-foo="1"><tbody><tr><td>1</td></tr></tbody></table><img data-asset-id="abc" data-bar="2">',
    );
    expect(html).toBe(
      '<table data-chart="{&quot;x&quot;:&quot;経過&quot;}"><tbody><tr><td>1</td></tr></tbody></table><img data-asset-id="abc">',
    );
  });
});
