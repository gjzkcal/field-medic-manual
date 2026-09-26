/**
 * 見出しから GitHub 形式のスラッグを作る（小文字にし、記号を除き、空白を `-` にする。日本語はそのまま残す）。
 * 同じ文書の中で重複したら `-2` `-3` を付ける。
 */
export class AnchorAllocator {
  readonly #used = new Set<string>();

  allocate(text: string, fallback = "section"): string {
    const slug = slugify(text);
    const base = slug === "" ? fallback : slug;
    let anchor = base;
    for (let n = 2; this.#used.has(anchor); n++) {
      anchor = `${base}-${String(n)}`;
    }
    this.#used.add(anchor);
    return anchor;
  }
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}
