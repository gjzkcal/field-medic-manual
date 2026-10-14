import { describe, expect, it } from "vitest";

import { convertManual } from "@/features/content/markdown";
import type { ManualSource } from "@/features/content/types";
import { CONVERT_TIMEOUT_MS, noData, noImages } from "@/test/samples";

function manual(text: string): ManualSource {
  return { fileName: "x.md", path: "/content/manuals/x.md", text, hash: "h" };
}

async function convert(markdown: string): Promise<{ html: string; plainText: string; warnings: string[] }> {
  const { doc, warnings } = await convertManual(manual(`# A\n\n${markdown}`), noImages, noData);
  return { html: doc.sections[0]?.html ?? "", plainText: doc.sections[0]?.plainText ?? "", warnings };
}

describe("式の変換", { timeout: CONVERT_TIMEOUT_MS }, () => {
  it("独立した式は中央に置く箱の中の MathML にする", async () => {
    const { html, plainText, warnings } = await convert(
      String.raw`$$
\text{成功率} = \frac{b - 0.2}{0.7 - 0.2}
$$`,
    );
    expect(warnings).toEqual([]);
    const box = new DOMParser().parseFromString(html, "text/html").querySelector(".manual-math");
    expect(box?.querySelector("math[display='block'] mfrac")).not.toBeNull();
    expect(html).not.toContain("<pre");
    expect(plainText).toBe("成功率 = (b − 0.2) ÷ (0.7 − 0.2)");
  });

  it("文中・箇条書き・表のセルの式は、文の中の MathML にする", async () => {
    const { html, plainText, warnings } = await convert(
      String.raw`濃度は $x = (C \div 100)^2$ で決まる。

- $e^{-k t}$ と $C_{\text{mor}}$
- $\left( \frac{k_d}{k_a} \right)^{2}$ と $\mathrm{EC}_{50}$

| 式 |
|---|
| $\sqrt{2}$ |`,
    );
    expect(warnings).toEqual([]);
    const body = new DOMParser().parseFromString(html, "text/html").body;
    expect(body.querySelector("p > math:not([display])")).not.toBeNull();
    expect(body.querySelectorAll("li math")).toHaveLength(4);
    expect(body.querySelector("td > math msqrt")).not.toBeNull();
    expect(body.querySelector(".manual-math")).toBeNull();
    expect(plainText).toContain("濃度は x = (C ÷ 100)^2 で決まる。");
    expect(plainText).toContain("e^(−kt) と C_mor");
    // 添字の付いた記号や文字だけの項は、括弧を重ねない
    expect(plainText).toContain("(k_d ÷ k_a)^2 と EC_50");
    expect(plainText).toContain("√(2)");
  });

  it("インラインコードやコードブロックの中の $ は式にしない", async () => {
    const { html, warnings } = await convert("`$a$`\n\n```\n$$\nb\n$$\n```");
    expect(warnings).toEqual([]);
    expect(html).not.toContain("<math");
    expect(html).toContain("<code>$a$</code>");
  });

  it("TeX の書き間違いは警告にして、元の式をコードのまま残す", async () => {
    const { html, warnings } = await convert(String.raw`式 $\frac{a$ の誤り`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(String.raw`式「\frac{a」を数式にできませんでした`);
    expect(html).not.toContain("<math");
    expect(html).toContain(String.raw`\frac{a`);
  });
});
