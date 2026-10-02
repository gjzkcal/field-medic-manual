// HTML（md・docx・URL などから作ったもの）を見出しでセクションに分ける共通処理。
// 画像の取り込み → 入れ物の展開 → h1〜h3 で分割 → セクションのタグと表示条件の抽出 → 無害化、の順に行う。
import { AnchorAllocator } from "@/features/content/anchor";
import { sha256Hex } from "@/features/content/hash";
import { parseTags } from "@/features/content/meta";
import { extensionForMime, fileName } from "@/features/content/path";
import { cleanInlineText, sanitizeHtml } from "@/features/content/sanitize";
import type { NormalizedAsset, NormalizedSection } from "@/features/content/types";
import type { ModConditions } from "@/features/settings/mod-conditions";
import { isSelectableMod, SELECTABLE_MODS } from "@/features/settings/mod-settings";
import type { ModTarget } from "@/lib/bindings/ModTarget";

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
const MODS_COMMENT = /^\s*mods\s*[:：](.*)$/is;
const NO_CONDITIONS: ModConditions = { mods: [], withoutMods: [] };

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
  // 見出しの表示条件は配下の深い見出しにも効くので、開いている見出しの条件を積んでおく
  const conditionStack: { level: number; conditions: ModConditions }[] = [];
  let firstH1: string | null = null;
  for (const chunk of chunks) {
    const headingText = chunk.heading === null ? "" : cleanInlineText(chunk.heading.textContent);
    const where = chunk.heading === null ? "見出しの前" : `「${headingText}」`;
    const markers = takeSectionMarkers(chunk.nodes, where, warnings);
    const container = body.ownerDocument.createElement("div");
    container.append(...chunk.nodes);
    warnMisplacedMods(container, where, warnings);
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
        tags: markers.tags,
        mods: [],
        withoutMods: [],
      });
      continue;
    }
    while ((conditionStack.at(-1)?.level ?? 0) >= chunk.level) {
      conditionStack.pop();
    }
    const conditions = mergeConditions(
      conditionStack.at(-1)?.conditions ?? NO_CONDITIONS,
      markers.conditions,
      where,
      warnings,
    );
    conditionStack.push({ level: chunk.level, conditions });
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
      tags: markers.tags,
      mods: [...conditions.mods],
      withoutMods: [...conditions.withoutMods],
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

interface SectionMarkers {
  tags: string[];
  conditions: ModConditions;
}

/**
 * 見出しの直後に書かれたセクションのタグと表示条件を取り出し、本文から除く（両方あれば順は問わない）。
 * タグは `<!-- tags: a, b -->`（md / html）か `タグ: a, b` の段落（txt / docx）。
 * 表示条件は `<!-- mods: circulation, !hitzones -->`（! は「入れていないとき」）。
 */
function takeSectionMarkers(nodes: Node[], where: string, warnings: string[]): SectionMarkers {
  const markers: SectionMarkers = { tags: [], conditions: NO_CONDITIONS };
  let index = 0;
  for (let node = nodes[index]; node !== undefined; node = nodes[index]) {
    if (node.nodeType === Node.TEXT_NODE && isBlank(node)) {
      index += 1;
      continue;
    }
    const comment = node.nodeType === Node.COMMENT_NODE ? (node.textContent ?? "") : null;
    const tagLine =
      node instanceof Element && node.tagName === "P" ? TAG_LINE.exec(node.textContent) : null;
    const tags = comment === null ? tagLine?.[1] : TAG_COMMENT.exec(comment)?.[1];
    const mods = comment === null ? undefined : MODS_COMMENT.exec(comment)?.[1];
    if (tags !== undefined) {
      markers.tags = parseTags(tags);
    } else if (mods !== undefined) {
      markers.conditions = parseModConditions(mods, where, warnings);
    } else {
      break;
    }
    nodes.splice(index, 1);
  }
  return markers;
}

function parseModConditions(raw: string, where: string, warnings: string[]): ModConditions {
  const mods: ModTarget[] = [];
  const withoutMods: ModTarget[] = [];
  for (const token of raw.split(/[,、\s]+/).filter((t) => t !== "")) {
    // 日本語入力のまま書いた全角の ! も受ける
    const without = /^[!！]/.test(token);
    const name = token.replace(/^[!！]/, "").toLowerCase();
    // core と general は常に有効なので条件にならず、ここで不明として扱う
    if (!isSelectableMod(name)) {
      warnings.push(
        `mods の値が不明です: ${token}（${where}。${SELECTABLE_MODS.join(" / ")} のどれか。! を付けると入れていないとき）`,
      );
      continue;
    }
    const list = without ? withoutMods : mods;
    if (!list.includes(name)) {
      list.push(name);
    }
  }
  return { mods, withoutMods };
}

/** 親の見出しの条件に自分の条件を足す。「あり」と「なし」が重なると、どの設定でも出ない節になるので警告する */
function mergeConditions(
  parent: ModConditions,
  own: ModConditions,
  where: string,
  warnings: string[],
): ModConditions {
  const merged: ModConditions = {
    mods: [...new Set([...parent.mods, ...own.mods])],
    withoutMods: [...new Set([...parent.withoutMods, ...own.withoutMods])],
  };
  const both = merged.mods.filter((m) => merged.withoutMods.includes(m));
  if (both.length > 0) {
    warnings.push(`mods に同じ MOD の「あり」と「なし」があります: ${both.join(", ")}（${where}）`);
  }
  return merged;
}

/** 見出しの直後にない mods の印は効かない（h4 以下の見出しの後ろも含む）。黙って捨てずに書き間違いとして知らせる */
function warnMisplacedMods(container: Element, where: string, warnings: string[]): void {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (MODS_COMMENT.test(node.textContent ?? "")) {
      warnings.push(`mods の印は h1〜h3 の見出しの直後に書いてください（${where}）`);
    }
  }
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
