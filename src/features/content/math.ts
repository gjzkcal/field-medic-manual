// 原稿の LaTeX の式（`$…$` / `$$…$$`）を MathML にする。
// KaTeX ではなく Temml にしたのは、出力が MathML だけで、無害化で落とすインラインの style やフォントの同梱に頼らないため。

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/**
 * remark-math が残した `code.math-inline` / `pre > code.math-display` を MathML に置き換える。
 * TeX の書き間違いは警告にして、元のコードのまま残す（同梱の原稿は警告 0 を検査しているので、誤りに気づける）。
 * Temml は式のある原稿を変換するときにだけ読み込む（起動時に読み込むと起動が遅くなるため）。
 */
export async function markMath(body: HTMLElement, warnings: string[]): Promise<void> {
  const codes = Array.from(body.querySelectorAll("code.math-inline, code.math-display"));
  if (codes.length === 0) {
    return;
  }
  const { default: temml } = await import("temml");
  for (const code of codes) {
    const displayMode = code.classList.contains("math-display");
    const tex = code.textContent;
    let mathml: string;
    try {
      mathml = temml.renderToString(tex, { displayMode, throwOnError: true });
    } catch (error: unknown) {
      warnings.push(
        `式「${tex.trim()}」を数式にできませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    // innerHTML に入れるのは Temml が組んだ文字列だけ。ここは表示しない文書の中で、この後に DOMPurify を必ず通す
    const template = body.ownerDocument.createElement("template");
    template.innerHTML = mathml;
    const parent = code.parentElement;
    if (displayMode && parent?.tagName === "PRE") {
      // 独立した式は幅が足りないと横にスクロールさせる。math 自体に overflow を付けて中央に寄せると、
      // はみ出した左側がスクロールで戻せなくなるので、スクロールする箱で包んで中の式を寄せる
      const box = body.ownerDocument.createElement("div");
      box.className = "manual-math";
      box.append(template.content);
      parent.replaceWith(box);
    } else {
      code.replaceWith(template.content);
    }
  }
}

export function isMathElement(node: Node): node is Element {
  return node instanceof Element && node.namespaceURI === MATHML_NS;
}

/**
 * 検索用の本文に入れる式の文字列。MathML の文字を並べるだけだと、分数の分子と分母がつながって
 * 存在しない語ができ、スニペットでも読めないので、分数・べき・添字を `÷` `^` `_` の 1 行の形にする。
 */
export function mathToPlainText(math: Element): string {
  return linear(math).replace(/\s+/g, " ").trim();
}

/** 関数の適用などの見えない演算子（U+2061〜U+2064）。表示されないので検索の本文から除く */
const INVISIBLE_OPERATORS = /[\u2061-\u2064]/g;
const TOKEN_ELEMENTS = new Set(["mi", "mn", "mtext", "ms"]);
/** 添字やべきの付いた 1 つの記号（`k_d` など）。それ自体で 1 項なので括弧で囲まない */
const SCRIPTED_ELEMENTS = new Set(["msub", "msup", "msubsup", "msqrt"]);

function linear(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(INVISIBLE_OPERATORS, "");
  }
  if (!(node instanceof Element)) {
    return "";
  }
  const children = Array.from(node.children);
  const [first, second] = children;
  switch (node.localName) {
    case "annotation":
    case "annotation-xml":
      // TeX の原文などの注記。画面には出ないので検索にも入れない
      return "";
    case "mspace":
      return " ";
    case "mo":
      return operator(node);
    case "mfrac":
      return first === undefined || second === undefined ? "" : `${group(first)} ÷ ${group(second)}`;
    case "msup":
      return first === undefined || second === undefined ? "" : `${group(first)}^${group(second)}`;
    case "msub":
      return first === undefined || second === undefined ? "" : `${group(first)}_${group(second)}`;
    case "msubsup": {
      const third = children[2];
      return first === undefined || second === undefined || third === undefined
        ? ""
        : `${group(first)}_${group(second)}^${group(third)}`;
    }
    case "msqrt":
      return `√(${children.map(linear).join("").trim()})`;
    default:
      return Array.from(node.childNodes).map(linear).join("");
  }
}

/** 二項演算子の前後に空白を入れ、元のインラインコードの式（`a × b`）と同じ読みやすさにする */
function operator(mo: Element): string {
  const text = mo.textContent.replace(INVISIBLE_OPERATORS, "");
  if (text === "") {
    return "";
  }
  // 単項のマイナス（`e^{-kt}`）は詰める。無害化で form 属性は落ちるので、MathML の規則と同じく行の先頭なら前置とみなす
  const prefix = mo.previousElementSibling === null && mo.nextElementSibling !== null;
  if (mo.getAttribute("fence") === "true" || prefix) {
    return text;
  }
  if (mo.getAttribute("separator") === "true") {
    return `${text} `;
  }
  return ` ${text} `;
}

/** べき・添字・分数の 1 つの項。1 語でなければ括弧で囲み、`e^(−kt)` のように範囲が分かるようにする */
function group(node: Element): string {
  const children = Array.from(node.children);
  if (node.localName === "mrow" && children.length === 1 && children[0] !== undefined) {
    return group(children[0]);
  }
  const text = linear(node).replace(/\s+/g, " ").trim();
  // `\mathrm{EC}` のように文字だけが並ぶ項も 1 語として扱う
  const word = children.length > 0 && children.every((child) => TOKEN_ELEMENTS.has(child.localName));
  if (
    TOKEN_ELEMENTS.has(node.localName) ||
    SCRIPTED_ELEMENTS.has(node.localName) ||
    word ||
    isFenced(children)
  ) {
    return text;
  }
  return `(${text})`;
}

/**
 * すでに括弧で囲まれた項（`(C ÷ 100)` など）は、括弧を重ねない。
 * `(a)(b)` のように両端が括弧でも中にも括弧があるものは、1 組の括弧で囲まれているとは限らないので囲む。
 */
function isFenced(children: Element[]): boolean {
  const fences = children.filter(
    (child) => child.localName === "mo" && child.getAttribute("fence") === "true",
  );
  return fences.length === 2 && fences[0] === children.at(0) && fences[1] === children.at(-1);
}
