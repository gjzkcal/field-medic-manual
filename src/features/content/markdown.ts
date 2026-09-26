// 同梱する Markdown の原稿を、DB に入れる形（NormalizedDoc）に変換する。ルールは dev-docs/reference/bundled-content.md §5。
import { sectionsFromBody } from "@/features/content/document";
import { sha256Hex } from "@/features/content/hash";
import { emptyMeta, toDocMeta } from "@/features/content/meta";
import { fileName, fileStem, imageMime, resolveRelative } from "@/features/content/path";
import type {
  ConvertedManual,
  ManualSource,
  NormalizedAsset,
  ReadImage,
} from "@/features/content/types";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Markdown を HTML にする。ライブラリは初めて使うときに読み込む（起動時に読み込むと起動が遅くなるため）。
 * 生の HTML（`<!-- tags: -->` や <br> など）を残すため allowDangerousHtml + rehype-raw にする。
 * 危険な要素は、この後の DOMPurify（sanitize.ts）で必ず取り除く。
 */
async function markdownToHtml(markdown: string): Promise<string> {
  const [unified, remarkParse, remarkGfm, remarkRehype, rehypeRaw, rehypeStringify] =
    await Promise.all([
      import("unified"),
      import("remark-parse"),
      import("remark-gfm"),
      import("remark-rehype"),
      import("rehype-raw"),
      import("rehype-stringify"),
    ]);
  const file = await unified
    .unified()
    .use(remarkParse.default)
    .use(remarkGfm.default)
    .use(remarkRehype.default, { allowDangerousHtml: true })
    .use(rehypeRaw.default)
    .use(rehypeStringify.default)
    .process(markdown);
  return String(file);
}

export async function convertManual(
  manual: ManualSource,
  readImage: ReadImage,
): Promise<ConvertedManual> {
  const warnings: string[] = [];
  const { frontMatter, body } = await splitFrontMatter(manual.text, warnings);

  const html = await markdownToHtml(body);
  const doc = new DOMParser().parseFromString(html, "text/html");
  markAlerts(doc.body);
  const result = await sectionsFromBody(doc.body, {
    resolveImage: (src) => readRelativeImage(manual.path, src, readImage),
  });
  warnings.push(...result.warnings);

  const meta = frontMatter === null ? emptyMeta() : toDocMeta(frontMatter, warnings);
  const title = textValue(frontMatter?.["title"]) ?? result.firstH1 ?? fileStem(manual.fileName);
  return {
    doc: {
      title,
      sourceType: "markdown",
      sourcePath: `bundle://manuals/${manual.fileName}`,
      sourceHash: manual.hash,
      meta,
      sections: result.sections,
      assets: result.assets,
    },
    warnings,
  };
}

/** 原稿から相対パスで参照された画像を読んでアセットにする。URL や絶対パスは null（呼び出し側でリンクにするか消す）。 */
async function readRelativeImage(
  manualPath: string,
  src: string,
  readImage: ReadImage,
): Promise<NormalizedAsset | null> {
  const path = resolveRelative(manualPath, src);
  if (path === null) {
    return null;
  }
  const mime = imageMime(path);
  if (mime === null) {
    throw new Error("画像の拡張子ではありません");
  }
  const bytes = await readImage(path);
  return { id: await sha256Hex(bytes), fileName: fileName(path), mime, bytes };
}

interface FrontMatter extends Record<string, unknown> {
  mod?: unknown;
  channel?: unknown;
  modVersion?: unknown;
  verifiedAt?: unknown;
  tags?: unknown;
}

async function splitFrontMatter(
  text: string,
  warnings: string[],
): Promise<{ frontMatter: FrontMatter | null; body: string }> {
  const match = FRONT_MATTER.exec(text);
  if (match === null) {
    return { frontMatter: null, body: text };
  }
  const body = text.slice(match[0].length);
  const { parse: parseYaml } = await import("yaml");
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch (error: unknown) {
    warnings.push(`front matter を読めませんでした: ${String(error)}`);
    return { frontMatter: null, body };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { frontMatter: null, body };
  }
  // 原稿では snake_case（mod_version / verified_at）で書く。content-guide.md の書式に合わせる
  const record = Object.fromEntries(Object.entries(parsed));
  return {
    frontMatter: {
      ...record,
      modVersion: record["mod_version"],
      verifiedAt: record["verified_at"],
    },
    body,
  };
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

const ALERT_TITLES: Record<string, string> = {
  NOTE: "メモ",
  TIP: "ヒント",
  IMPORTANT: "重要",
  WARNING: "警告",
  CAUTION: "注意",
};
const ALERT_MARKER = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/** GFM の Alert（`> [!WARNING]`）を、ビューアで強調できるようクラス付きの blockquote にする。 */
function markAlerts(body: HTMLElement): void {
  for (const quote of Array.from(body.querySelectorAll("blockquote"))) {
    const first = quote.querySelector("p");
    const textNode = first?.firstChild;
    if (first === null || textNode?.nodeType !== Node.TEXT_NODE) {
      continue;
    }
    const match = ALERT_MARKER.exec(textNode.textContent ?? "");
    const kind = match?.[1]?.toUpperCase();
    if (match === null || kind === undefined) {
      continue;
    }
    textNode.textContent = (textNode.textContent ?? "").slice(match[0].length);
    if (first.textContent.trim() === "") {
      first.remove();
    }
    quote.classList.add("markdown-alert", `markdown-alert-${kind.toLowerCase()}`);
    const title = body.ownerDocument.createElement("p");
    title.className = "markdown-alert-title";
    title.textContent = ALERT_TITLES[kind] ?? kind;
    quote.prepend(title);
  }
}
