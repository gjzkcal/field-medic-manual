// HTML（md・docx・URL などから作ったもの）を見出しでセクションに分ける共通処理。
// 画像の取り込み → 入れ物の展開 → h1〜h3 で分割 → セクションのタグの抽出 → 無害化、の順に行う。
import { AnchorAllocator } from "@/features/content/anchor";
import { sha256Hex } from "@/features/content/hash";
import { parseTags } from "@/features/content/meta";
import { extensionForMime, fileName } from "@/features/content/path";
import { cleanInlineText, sanitizeHtml } from "@/features/content/sanitize";
import type { NormalizedAsset, NormalizedSection } from "@/features/content/types";

export interface SectionsOptions {
  /**
   * 相対パスの画像を読んでアセットにする。null を返すか例外なら取り込めなかったとみなす。
   * 省略すると相対パスの画像は取り込まない（URL 取り込みなど）。
   */
  resolveImage?: (src: string) => Promise<NormalizedAsset | null>;
}

export interface SectionsResult {
  sections: NormalizedSection[];
  assets: NormalizedAsset[];
  warnings: string[];
  /** 最初の h1 の文字列。タイトルの候補にする */
  firstH1: string | null;
}

const SPLIT_HEADINGS = "h1, h2, h3";
const HEADING_LEVEL: Record<string, number> = { H1: 1, H2: 2, H3: 3 };
// 見出しを含むこれらの要素は分割の邪魔になるので中身だけを並べ直す（Readability の出力や <section> で組んだページのため）
const CONTAINERS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE"]);
const TAG_COMMENT = /^\s*tags\s*[:：](.*)$/is;
const TAG_LINE = /^\s*(?:タグ|tags)\s*[:：](.*)$/is;

/** HTML の文字列をセクションに分ける。DOMParser で作った文書はスクリプトを実行せず、画像なども読みに行かない。 */
export async function sectionsFromHtml(
  html: string,
  options: SectionsOptions = {},
): Promise<SectionsResult> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return sectionsFromBody(doc.body, options);
}

/** `body` の中身をセクションに分ける。`body` は書き換える。 */
export async function sectionsFromBody(
  body: HTMLElement,
  options: SectionsOptions = {},
): Promise<SectionsResult> {
  const warnings: string[] = [];
  const assets = await importImages(body, options, warnings);
  const chunks = splitByHeadings(flatten(body));

  const anchors = new AnchorAllocator();
  const sections: NormalizedSection[] = [];
  let firstH1: string | null = null;
  for (const chunk of chunks) {
    const tags = takeSectionTags(chunk.nodes);
    const container = body.ownerDocument.createElement("div");
    container.append(...chunk.nodes);
    const { html, plainText } = sanitizeHtml(container.innerHTML);

    if (chunk.heading === null) {
      // 見出しより前に中身がなければ導入部は作らない
      if (plainText === "" && !html.includes("<img")) {
        continue;
      }
      sections.push({
        level: 0,
        title: "",
        anchor: anchors.allocate("intro"),
        html,
        plainText,
        tags,
      });
      continue;
    }
    const headingText = cleanInlineText(chunk.heading.textContent);
    const title = headingText === "" ? "（無題の見出し）" : headingText;
    if (chunk.level === 1) {
      firstH1 ??= title;
    }
    sections.push({
      level: chunk.level,
      title,
      anchor: anchors.allocate(title),
      html,
      plainText,
      tags,
    });
  }
  return { sections, assets, warnings, firstH1 };
}

interface Chunk {
  heading: Element | null;
  level: number;
  nodes: Node[];
}

function flatten(parent: Element): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (
      child instanceof Element &&
      CONTAINERS.has(child.tagName) &&
      child.querySelector(SPLIT_HEADINGS) !== null
    ) {
      out.push(...flatten(child));
    } else {
      out.push(child);
    }
  }
  return out;
}

function splitByHeadings(nodes: Node[]): Chunk[] {
  const chunks: Chunk[] = [{ heading: null, level: 0, nodes: [] }];
  for (const node of nodes) {
    const level = node instanceof Element ? HEADING_LEVEL[node.tagName] : undefined;
    if (node instanceof Element && level !== undefined) {
      chunks.push({ heading: node, level, nodes: [] });
    } else {
      chunks.at(-1)?.nodes.push(node);
    }
  }
  return chunks;
}

/**
 * 見出しの直後に書かれたセクションのタグを取り出し、本文から除く。
 * 書き方は `<!-- tags: a, b -->`（md / html）か `タグ: a, b` の段落（txt / docx）。dev-docs/reference/content-guide.md。
 */
function takeSectionTags(nodes: Node[]): string[] {
  const index = nodes.findIndex((n) => !(n.nodeType === Node.TEXT_NODE && isBlank(n)));
  const first = nodes[index];
  if (first === undefined) {
    return [];
  }
  let raw: string | undefined;
  if (first.nodeType === Node.COMMENT_NODE) {
    raw = TAG_COMMENT.exec(first.textContent ?? "")?.[1];
  } else if (first instanceof Element && first.tagName === "P") {
    raw = TAG_LINE.exec(first.textContent)?.[1];
  }
  if (raw === undefined) {
    return [];
  }
  nodes.splice(index, 1);
  return parseTags(raw);
}

function isBlank(node: Node): boolean {
  return (node.textContent ?? "").trim() === "";
}

/**
 * 画像をアセットにして `<img data-asset-id>` に置き換える。
 * 取り込めない外部の画像はリンクにし、それ以外は消して警告する（保存する HTML に外部 URL やローカルのパスを残さないため）。
 */
async function importImages(
  body: HTMLElement,
  options: SectionsOptions,
  warnings: string[],
): Promise<NormalizedAsset[]> {
  const assets = new Map<string, NormalizedAsset>();
  for (const img of Array.from(body.querySelectorAll("img"))) {
    const src = img.getAttribute("src")?.trim() ?? "";
    const alt = img.getAttribute("alt")?.trim() ?? "";
    let asset: NormalizedAsset | null = null;
    try {
      if (src.startsWith("data:")) {
        asset = await dataUriToAsset(src, assets.size + 1);
      } else if (src !== "" && !isHttpUrl(src) && options.resolveImage !== undefined) {
        asset = await options.resolveImage(src);
      }
    } catch (error: unknown) {
      warnings.push(`画像を読み込めませんでした: ${src}（${String(error)}）`);
    }

    if (asset !== null) {
      assets.set(asset.id, asset);
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      img.setAttribute("data-asset-id", asset.id);
      continue;
    }
    if (isHttpUrl(src)) {
      const link = body.ownerDocument.createElement("a");
      link.setAttribute("href", src);
      link.textContent = `[画像: ${imageLinkLabel(alt, src)}]`;
      img.replaceWith(link);
      continue;
    }
    if (src !== "" && !warnings.some((w) => w.includes(src))) {
      warnings.push(`画像を読み込めませんでした: ${src}`);
    }
    img.remove();
  }
  return [...assets.values()];
}

function imageLinkLabel(alt: string, src: string): string {
  if (alt !== "") {
    return alt;
  }
  const name = fileName(new URL(src).pathname);
  return name === "" ? src : name;
}

function isHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

async function dataUriToAsset(src: string, n: number): Promise<NormalizedAsset | null> {
  const match = /^data:([^;,]+)((?:;[^;,]+)*?)(;base64)?,(.*)$/is.exec(src);
  const mime = match?.[1]?.toLowerCase();
  const payload = match?.[4];
  if (mime === undefined || payload === undefined || !mime.startsWith("image/")) {
    return null;
  }
  const bytes =
    match?.[3] === undefined
      ? new TextEncoder().encode(decodeURIComponent(payload))
      : Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  return {
    id: await sha256Hex(bytes),
    fileName: `image-${String(n)}.${extensionForMime(mime)}`,
    mime,
    bytes,
  };
}
