// 本文のリンクの行き先を分類する。原稿での書き方は dev-docs/reference/content-guide.md §4。

export type ResolvedLink =
  | { kind: "external"; url: string }
  | { kind: "anchor"; anchor: string }
  | { kind: "doc"; fileName: string; anchor: string | null }
  | { kind: "unknown" };

const EXTERNAL = /^(?:https?|mailto):/i;
// 原稿は content/manuals/ の直下に並べるので、同じフォルダの md だけを内部リンクとして扱う
const MANUAL_LINK = /^(?:\.\/)?([a-z0-9-]+\.md)(?:#(.*))?$/i;

export function resolveLink(href: string): ResolvedLink {
  const trimmed = href.trim();
  if (EXTERNAL.test(trimmed)) {
    return { kind: "external", url: trimmed };
  }
  if (trimmed.startsWith("#")) {
    const anchor = decodeAnchor(trimmed.slice(1));
    return anchor === "" ? { kind: "unknown" } : { kind: "anchor", anchor };
  }
  const match = MANUAL_LINK.exec(trimmed);
  const file = match?.[1];
  if (file === undefined) {
    return { kind: "unknown" };
  }
  const anchor = decodeAnchor(match?.[2] ?? "");
  return { kind: "doc", fileName: file.toLowerCase(), anchor: anchor === "" ? null : anchor };
}

/** md の変換で日本語のアンカーは % エンコードされるので、見出しの id と比べられるように戻す。 */
export function decodeAnchor(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // 不正な % の並びは、書かれたとおりの文字列として扱う
    return raw;
  }
}

export const HIGHLIGHT_PARAM = "hl";

/**
 * ビューアの URL。アンカーは日本語を含むので % エンコードする（読むときは decodeAnchor で戻す）。
 * highlight を渡すと、開いた先でその語をハイライトする（検索結果から開いたとき）。
 */
export function docHref(
  docId: string,
  anchor: string | null,
  highlight: readonly string[] = [],
): string {
  const params = new URLSearchParams(highlight.map((term) => [HIGHLIGHT_PARAM, term]));
  const query = params.size === 0 ? "" : `?${params.toString()}`;
  const hash = anchor === null ? "" : `#${encodeURIComponent(anchor)}`;
  return `/doc/${encodeURIComponent(docId)}${query}${hash}`;
}

/** URL の検索部分（location.search）から、ハイライトする語を取り出す。 */
export function highlightTermsOf(search: string): string[] {
  return new URLSearchParams(search).getAll(HIGHLIGHT_PARAM).filter((term) => term.trim() !== "");
}
