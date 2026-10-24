// 原稿の HTML の無害化。保存するとき（document.ts）と表示するとき（ビューア）の両方でここを通す（設定を 1 か所にまとめ、漏れを防ぐため）。
import DOMPurify, { type Config } from "dompurify";

import { isMathElement, mathToPlainText } from "@/features/content/math";

const CONFIG: Config = {
  // 式は MathML で組む（math.ts）。フローチャートの SVG はビューアが自分で描くので、原稿の HTML には SVG を許さない
  USE_PROFILES: { html: true, mathMl: true },
  // 見た目や操作を持ち込む要素は、閲覧専用のマニュアルには要らず、ビューアの表示を崩すので落とす
  FORBID_TAGS: [
    "style",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "source",
    "picture",
  ],
  // src / srcset を残すと閲覧時に外部やローカルのファイルを読みに行く。画像は data-asset-id で参照する
  FORBID_ATTR: ["style", "src", "srcset"],
  ALLOW_DATA_ATTR: false,
  // data-chart はグラフにする表の印、data-flowchart はフローチャートの中身（どちらも JSON）。ビューアは形を確かめてから使い、HTML としては扱わない
  ADD_ATTR: ["data-asset-id", "data-chart", "data-flowchart", "data-mod-columns"],
};

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

// MathML のプロファイルは href を許すが、Firefox では href の付いた式がリンクになり、ビューアの a[href] のクリックの処理
// （外部は既定のブラウザで開き、内部はアプリの中で移る）を通らずにページを移れてしまう。式にリンクは要らないので落とす
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (node.namespaceURI === MATHML_NS && (data.attrName === "href" || data.attrName === "xlink:href")) {
    data.keepAttr = false;
  }
});

export interface SanitizedHtml {
  html: string;
  plainText: string;
}

/**
 * ビューアで表示する直前の無害化。保存時にも通しているが、DB の中身を書き換えられた場合に備えてもう一度通す（多層防御）。
 * 文字列ではなく DOM で返し、innerHTML を使わずにそのまま差し込めるようにする。
 */
export function sanitizeToFragment(dirty: string): DocumentFragment {
  return DOMPurify.sanitize(dirty, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
}

export function sanitizeHtml(dirty: string): SanitizedHtml {
  const fragment = sanitizeToFragment(dirty);
  const container = document.createElement("div");
  container.append(fragment);
  return { html: container.innerHTML.trim(), plainText: toPlainText(container) };
}

/** 見出しなどの短い文字列。HTML ではなく文字列として扱うので、空白をまとめるだけにする。 */
export function cleanInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

/**
 * 検索用の本文。textContent だと段落の境目で語がつながり、trigram の索引に存在しない語ができるため、
 * ブロックの境目に改行、表のセルの境目に空白を入れる。
 */
export function toPlainText(root: Node): string {
  const out: string[] = [];
  walk(root, out);
  return out
    .join("")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? "");
    return;
  }
  if (isMathElement(node)) {
    // 独立した式（`$$…$$`）は段落と同じくブロックなので、前後の語とつなげない
    const block = node.getAttribute("display") === "block";
    out.push(block ? "\n" : "", mathToPlainText(node), block ? "\n" : "");
    return;
  }
  if (!(node instanceof Element) && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }
  const tag = node instanceof Element ? node.tagName : "";
  if (tag === "BR") {
    out.push("\n");
    return;
  }
  const block = BLOCK_TAGS.has(tag);
  if (block) {
    out.push("\n");
  }
  for (const child of Array.from(node.childNodes)) {
    walk(child, out);
  }
  if (block) {
    out.push("\n");
  } else if (tag === "TD" || tag === "TH") {
    out.push(" ");
  }
}
