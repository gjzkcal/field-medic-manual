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
    const parent = code.parentElement;
    const display = code.classList.contains("math-display") && parent?.tagName === "PRE";
    const tex = code.textContent;
    let mathml: string;
    try {
      mathml = temml.renderToString(tex, { displayMode: display, throwOnError: true });
    } catch (error: unknown) {
      warnings.push(
        `式「${tex.trim()}」を数式にできませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    // innerHTML に入れるのは Temml が組んだ文字列だけ。ここは表示しない文書の中で、この後に DOMPurify を必ず通す
    const template = body.ownerDocument.createElement("template");
    template.innerHTML = mathml;
    const math = template.content.firstElementChild;
    if (display && math !== null) {
      parent.replaceWith(wrappableBox(math));
    } else {
      code.replaceWith(template.content);
    }
  }
}

/**
 * 独立した式を、折り返せる塊ごとの <math> に分けて箱に並べる。
 * Chromium（WebView2）は 1 つの <math> の中では改行しない（Temml の自動の改行も Firefox でしか効かない）ので、
 * 塊を別の <math> にして、箱の flex-wrap で行を送る。
 * 折れるのは TeX と同じく一番外側の演算子の後ろと、`\quad` 以上の空き（式の後ろの「（…）」の注記）の前。
 * 括弧や分数の中では折らない。
 */
function wrappableBox(math: Element): HTMLElement {
  const doc = math.ownerDocument;
  const items = topLevelItems(math);
  const chunks: Element[][] = [];
  let current: Element[] = [];
  items.forEach((item, index) => {
    current.push(item);
    const last = index === items.length - 1;
    const previous = items[index - 1];
    // 先頭や演算子の直後の演算子は単項（−x など）なので、後ろの項と離さない
    const operatorBreak = isBreakingOperator(item) && previous !== undefined && !isBreakingOperator(previous);
    if (!last && (operatorBreak || isQuad(item))) {
      chunks.push(current);
      current = [];
    }
  });
  chunks.push(current);

  const box = doc.createElement("div");
  box.className = "manual-math";
  chunks.forEach((chunk, index) => {
    if (index > 0) {
      // flex の箱の中の空白は表示されない。検索用の本文で、塊の境目の語がつながらないようにするためのもの
      box.append(" ");
    }
    const part = doc.createElementNS(MATHML_NS, "math");
    part.append(...chunk);
    box.append(part);
  });
  return box;
}

/** 式の一番外側の項と演算子の並び。Temml は式全体を 1 つの <mrow> で包むので、括弧で囲まれた項でない限りほどく */
function topLevelItems(math: Element): Element[] {
  let node = math;
  for (;;) {
    const children = Array.from(node.children);
    const only = children.length === 1 ? children[0] : undefined;
    if (only?.localName !== "mrow" || isFenced(Array.from(only.children))) {
      return children;
    }
    node = only;
  }
}

/** 後ろで折ってよい関係・二項の演算子（TeXbook p. 173 と同じ） */
const BREAKING_OPERATORS = new Set(["=", "≈", "≠", "<", ">", "≤", "≥", "⇔", "←", "→", "+", "−", "×", "÷", "⋅"]);

function isBreakingOperator(item: Element): boolean {
  if (item.localName === "mo") {
    return BREAKING_OPERATORS.has(item.textContent) && item.getAttribute("form") !== "prefix";
  }
  // 語（\text{}）と語の間の演算子は、Temml が前後の空きと一緒に <mrow> で包む
  const children = Array.from(item.children);
  const operators = children.filter((child) => child.localName !== "mspace");
  return (
    item.localName === "mrow" &&
    children.length > 1 &&
    operators.length === 1 &&
    operators[0]?.localName === "mo" &&
    isBreakingOperator(operators[0])
  );
}

function isQuad(item: Element): boolean {
  const width = /^([\d.]+)em$/.exec(item.getAttribute("width") ?? "");
  return item.localName === "mspace" && width?.[1] !== undefined && Number(width[1]) >= 1;
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
