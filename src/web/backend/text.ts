// 検索とタグで使う文字列の処理。デスクトップ版の Rust（src-tauri/src/db/text.rs）を移したもの。
// 同じ語で同じ節が当たるよう、大文字小文字の扱い（ASCII だけ区別しない）と文字数の数え方（コードポイント）をそろえる。
import { MARK_END, MARK_START } from "@/features/search/snippet";

const ELLIPSIS = "…";

/** ASCII の英字だけを小文字にする。SQLite の LIKE と NOCASE は ASCII だけ大文字小文字を区別しないため。 */
export function asciiLower(s: string): string {
  // 置き換えても長さが変わらないので、小文字にした文字列の位置を元の文字列にそのまま使える
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function equalsCi(a: string, b: string): boolean {
  return asciiLower(a) === asciiLower(b);
}

/** 強調の目印を取り除く。本文に紛れ込んでいるとスニペットの強調が壊れるため。 */
export function stripMarks(s: string): string {
  return s.replaceAll(MARK_START, "").replaceAll(MARK_END, "");
}

/**
 * 1 回の検索で使う語の数の上限。Rust の `MAX_TERMS` と同じ値にし、同じクエリで同じ結果にする
 * （デスクトップ版では、語が多いと SQLite の上限に当たって検索が失敗するため上限を設けている）。
 */
export const MAX_TERMS = 16;

/** 検索クエリを語に分ける。全角スペースも区切りにする。大文字小文字だけ違う語は 1 つにまとめる。語は先頭から MAX_TERMS 個まで。 */
export function splitTerms(query: string): string[] {
  return normalizeTerms(query.split(/\s+/)).slice(0, MAX_TERMS);
}

/** 語の並びを正規化する。前後の空白を除き、空は捨て、大文字小文字だけ違う重複をまとめる。 */
export function normalizeTerms(terms: Iterable<string>): string[] {
  const out: string[] = [];
  for (const raw of terms) {
    const term = stripMarks(raw.trim());
    if (term !== "" && !out.some((t) => equalsCi(t, term))) {
      out.push(term);
    }
  }
  return out;
}

/** タグを正規化する。前後の空白と先頭の `#` を除き、空は捨て、大文字小文字だけ違う重複をまとめる。 */
export function normalizeTags(tags: readonly string[]): string[] {
  return normalizeTerms(tags.map((t) => t.trim().replace(/^#+/, "")));
}

/** `needle` が最初に現れる範囲（UTF-16 の位置）。ASCII だけ大文字小文字を区別しない。 */
export function findCi(haystack: string, needle: string): { start: number; end: number } | null {
  if (needle === "") {
    return null;
  }
  const start = asciiLower(haystack).indexOf(asciiLower(needle));
  return start < 0 ? null : { start, end: start + needle.length };
}

export function containsCi(haystack: string, needle: string): boolean {
  return findCi(haystack, needle) !== null;
}

/**
 * スニペットを作る。`terms` のうち本文で最初に見つかった語を目印で強調し、前後を `contextChars` 文字ずつ残して省略記号を付ける。
 * 本文にない（タイトルやタグで当たった）場合は冒頭を返す。
 */
export function makeSnippet(text: string, terms: readonly string[], contextChars: number): string {
  let hit: { start: number; end: number } | null = null;
  for (const term of terms) {
    const found = findCi(text, term);
    if (found !== null && (hit === null || found.start < hit.start)) {
      hit = found;
    }
  }
  if (hit === null) {
    const chars = Array.from(text);
    const head = chars.slice(0, contextChars * 2).join("");
    return chars.length > contextChars * 2 ? `${head}${ELLIPSIS}` : head;
  }
  const before = Array.from(text.slice(0, hit.start));
  const skip = Math.max(0, before.length - contextChars);
  const after = Array.from(text.slice(hit.end));
  let out = skip > 0 ? ELLIPSIS : "";
  out += before.slice(skip).join("");
  out += `${MARK_START}${text.slice(hit.start, hit.end)}${MARK_END}`;
  out += after.slice(0, contextChars).join("");
  if (after.length > contextChars) {
    out += ELLIPSIS;
  }
  return out;
}

/** 文字数（コードポイント）。trigram が引ける長さかの判定に使う。 */
export function charLength(s: string): number {
  return Array.from(s).length;
}

/** SQLite の COLLATE NOCASE と同じ並び（ASCII だけ小文字にしてから比べる）。 */
export function compareNoCase(a: string, b: string): number {
  return compareBinary(asciiLower(a), asciiLower(b));
}

/** SQLite の既定の並び（BINARY）。localeCompare は読みの順になり、デスクトップ版と並びが変わるので使わない。 */
export function compareBinary(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** 比べた結果を順に見て、最初の 0 でないものを返す（並べ替えの第 2 キー以降に使う）。 */
export function firstNonZero(...results: number[]): number {
  return results.find((r) => r !== 0) ?? 0;
}
