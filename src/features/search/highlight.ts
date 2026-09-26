// 検索結果から開いた文書で、検索語をハイライトする。
// 本文は無害化した DOM を差し込んでいるので、要素を足して書き換えず、CSS Custom Highlight API で範囲に色だけ付ける。

export const SEARCH_HIGHLIGHT_NAME = "search-hit";

/** root の中の文字列から terms の出現箇所を探す（大文字小文字は無視）。要素をまたぐ一致は扱わない。 */
export function findTextRanges(root: Node, terms: readonly string[]): Range[] {
  const needles = [...new Set(terms.map((t) => t.trim().toLowerCase()))].filter((t) => t !== "");
  if (needles.length === 0) {
    return [];
  }
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const ranges: Range[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const lower = text.toLowerCase();
    // 小文字にすると長さが変わる文字（İ など）があると位置がずれるので、そのときは元の文字列のまま探す
    const haystack = lower.length === text.length ? lower : text;
    for (const needle of needles) {
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
        const range = doc.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/** 範囲に色を付け、消す関数を返す。Highlight API のない環境（テストの jsdom）では何もしない。 */
export function paintSearchHighlight(ranges: readonly Range[]): () => void {
  if (ranges.length === 0 || !("CSS" in globalThis) || !("highlights" in CSS)) {
    return () => undefined;
  }
  CSS.highlights.set(SEARCH_HIGHLIGHT_NAME, new Highlight(...ranges));
  return () => {
    CSS.highlights.delete(SEARCH_HIGHLIGHT_NAME);
  };
}
