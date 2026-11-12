// AI の回答と利用者の質問の Markdown を、表示する DOM にする。
// 見た目はビューアにそろえる（GFM の表・式は remark-math と Temml）。ただし原稿と違って作者が書いたものではないので、
// 生の HTML は通さず（rehype-raw を使わない）、リンクも文字にする（出典は画面がチップで示す）。
import { markMath } from "@/features/content/math";
import { sanitizeToFragment } from "@/features/content/sanitize";
import { parseFlowLink } from "@/features/triage/links";

export type AnswerPart = { kind: "markdown"; text: string } | { kind: "figure"; source: string };

/** AI が根拠の節の図を出すときに書く囲み。中身は節の source（`doc:<ファイル名>#<アンカー>`）だけ */
const FIGURE_FENCE = /^```figure[ \t]*\r?\n([^\n]*?)\r?\n```[ \t]*$/gmu;

// NOTE: 引用の場所の印は、私用領域の 2 文字で番号を挟む（例: U+E000 3 U+E001）。
// Markdown の記号と重ならず、変換と無害化をそのまま通るので、描いた後の文字の中から探して部品に差し替える。
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const MARK = /\uE000(\d+)\uE001/gu;

export function citationMark(index: number): string {
  return `${MARK_OPEN}${String(index)}${MARK_CLOSE}`;
}

/** 文字を、ふつうの文字と引用の印（番号）に分ける。 */
export function splitCitationMarks(text: string): (string | number)[] {
  const parts: (string | number)[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(Number(match[1]));
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

/**
 * 本文の頭から length 文字までを返す。ただし、引用の印と図の囲みの途中では切らない
 * （印の途中で切ると番号が文字として見え、図の囲みの途中で切るとコードの枠が一瞬出るため）。
 */
export function revealPrefix(text: string, length: number): string {
  let prefix = text.slice(0, length);
  const open = prefix.lastIndexOf(MARK_OPEN);
  if (open !== -1 && !prefix.includes(MARK_CLOSE, open)) {
    prefix = prefix.slice(0, open);
  }
  const figure = prefix.lastIndexOf("```figure");
  if (figure !== -1 && !prefix.slice(figure + 3).includes("\n```")) {
    prefix = prefix.slice(0, figure);
  }
  return prefix;
}

const FLOW_HREF_PREFIX = "#flow:";

/** 描いた DOM の中のフローへのリンクを、空の span に差し替える。span には、フローを開くボタンを portal で描く。 */
export function placeFlowLinks(
  root: HTMLElement,
): { slot: HTMLElement; flowId: string; label: string }[] {
  return Array.from(root.querySelectorAll(`a[href^="${FLOW_HREF_PREFIX}"]`)).map((anchor) => {
    const slot = root.ownerDocument.createElement("span");
    const flowId = (anchor.getAttribute("href") ?? "").slice(FLOW_HREF_PREFIX.length);
    const label = anchor.textContent.trim();
    anchor.replaceWith(slot);
    return { slot, flowId, label };
  });
}

/** 描いた DOM の中の引用の印を、空の span に差し替える。span には React の部品を portal で描く。 */
export function placeCitationMarks(root: HTMLElement): { slot: HTMLElement; index: number }[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.data.includes(MARK_OPEN)) {
      texts.push(node);
    }
  }
  const slots: { slot: HTMLElement; index: number }[] = [];
  for (const text of texts) {
    text.replaceWith(
      ...splitCitationMarks(text.data).map((part) => {
        if (typeof part === "string") {
          return root.ownerDocument.createTextNode(part);
        }
        const slot = root.ownerDocument.createElement("span");
        slots.push({ slot, index: part });
        return slot;
      }),
    );
  }
  return slots;
}

/** 本文を、Markdown の部分と図の部分に分ける。 */
export function splitFigures(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(FIGURE_FENCE)) {
    const source = match[1]?.trim() ?? "";
    if (match.index > last) {
      parts.push({ kind: "markdown", text: text.slice(last, match.index) });
    }
    parts.push({ kind: "figure", source });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: "markdown", text: text.slice(last) });
  }
  return parts.filter((p) => p.kind === "figure" || p.text.trim() !== "");
}

/**
 * 本文を、Markdown の塊（段落・表・リストなど。1 つずつ描いて、描いたものは描き直さない）に分ける。
 * 書いている途中（streaming）なら、最後の塊は閉じたか分からないので tail として文字のまま出す。
 * 表やコードの囲みを途中で Markdown にすると、行が届くたびに形が崩れて揺れるため。
 * 区切りは空行。ただし、コードの囲み（``` / ~~~）と式（$$）の中の空行と、
 * 字下げした行（リストの項目の続き）の前の空行では区切らない。
 */
export function splitBlocks(text: string, streaming: boolean): { blocks: string[]; tail: string } {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let inMath = false;
  let afterBlank = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const outside = fence === null && !inMath;
    if (outside && trimmed === "") {
      afterBlank = current.length > 0;
      current.push(line);
      continue;
    }
    if (outside && afterBlank && !/^\s/u.test(line)) {
      blocks.push(current.join("\n"));
      current = [];
    }
    afterBlank = false;
    const fenceMark = /^(`{3,}|~{3,})/u.exec(trimmed)?.[1];
    if (outside && fenceMark !== undefined) {
      fence = fenceMark.slice(0, 3);
    } else if (fence !== null && trimmed.startsWith(fence)) {
      fence = null;
    } else if (fence === null && trimmed === "$$") {
      inMath = !inMath;
    }
    current.push(line);
  }
  const last = current.join("\n");
  if (streaming) {
    return { blocks, tail: last };
  }
  return { blocks: last.trim() === "" ? blocks : [...blocks, last], tail: "" };
}

/** Markdown を、そのまま差し込める DOM にする。ライブラリは初めて使うときに読み込む。 */
export async function renderChatMarkdown(markdown: string): Promise<DocumentFragment> {
  const [unified, remarkParse, remarkGfm, remarkMath, remarkRehype, rehypeStringify] =
    await Promise.all([
      import("unified"),
      import("remark-parse"),
      import("remark-gfm"),
      import("remark-math"),
      import("remark-rehype"),
      import("rehype-stringify"),
    ]);
  const file = await unified
    .unified()
    .use(remarkParse.default)
    .use(remarkGfm.default)
    .use(remarkMath.default)
    // allowDangerousHtml を付けないので、Markdown の中の生の HTML は捨てられる
    .use(remarkRehype.default)
    .use(rehypeStringify.default)
    .process(markdown);
  // DOMParser で作った文書はスクリプトを実行せず、画像なども読みに行かない
  const doc = new DOMParser().parseFromString(String(file), "text/html");
  // 書き間違いの式は元のコードのまま残す（警告は回答の表示には要らない）
  await markMath(doc.body, []);
  for (const anchor of Array.from(doc.body.querySelectorAll("a"))) {
    const link = parseFlowLink(anchor.getAttribute("href") ?? "");
    if (link?.kind === "flow") {
      // フローへのリンクだけは残し、描いた後にフローを開くボタンにする（placeFlowLinks）。
      // 無害化は flow: の形を通さないので、ページ内のリンクの形にしておく
      const kept = doc.createElement("a");
      kept.setAttribute("href", `${FLOW_HREF_PREFIX}${link.flowId}`);
      kept.append(...Array.from(anchor.childNodes));
      anchor.replaceWith(kept);
    } else {
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
  }
  return sanitizeToFragment(doc.body.innerHTML);
}
