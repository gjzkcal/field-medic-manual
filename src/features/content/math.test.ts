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
    expect(box?.querySelector("math mfrac")).not.toBeNull();
    // 塊に分けても 1 つの式として読めるよう、式全体を名前にする
    expect(box?.getAttribute("role")).toBe("group");
    expect(box?.getAttribute("aria-label")).toBe("成功率 = (b − 0.2) ÷ (0.7 − 0.2)");
    expect(html).not.toContain("<pre");
    expect(plainText).toBe("成功率 = (b − 0.2) ÷ (0.7 − 0.2)");
  });

  it("独立した式は、一番外側の演算子の後ろと \\quad の前で折れる塊ごとの式に分ける", async () => {
    const { html, plainText, warnings } = await convert(
      String.raw`$$
\text{回復の速さ} = 5 \times (0.8 + x) \times \text{回復倍率}\ \text{HP/s} \quad \text{（注記）}
$$`,
    );
    expect(warnings).toEqual([]);
    const box = new DOMParser().parseFromString(html, "text/html").querySelector(".manual-math");
    const parts = Array.from(box?.children ?? []).map((part) => [part.localName, part.textContent]);
    // 括弧の中の + では分けない
    expect(parts).toEqual([
      ["math", "回復の速さ="],
      ["math", "5×"],
      ["math", "(0.8+x)×"],
      // `\ ` は詰めない空白（U+00A0）になる
      ["math", "回復倍率 HP/s"],
      ["math", "（注記）"],
    ]);
    expect(plainText).toBe("回復の速さ = 5 × (0.8 + x) × 回復倍率 HP/s （注記）");
  });

  it("分けられない式は 1 つの式のまま箱に入れる", async () => {
    const { html, warnings } = await convert(
      String.raw`$$
\begin{cases} 1 & x \\ 2 & y \end{cases}
$$`,
    );
    expect(warnings).toEqual([]);
    const box = new DOMParser().parseFromString(html, "text/html").querySelector(".manual-math");
    expect(box?.children).toHaveLength(1);
    expect(box?.querySelector("math mtable")).not.toBeNull();
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
    // 表の先頭の列は行の見出し（th）になる
    expect(body.querySelector("th[scope=row] > math msqrt")).not.toBeNull();
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
