// 検索の同義語辞書。デスクトップ版は初期値をマイグレーションで DB に入れ、利用者が編集できる。
// Web 版は編集できないので、同じ初期値の SQL をそのまま読む（同義語の元のデータを 1 か所に保つため）。
import seedSql from "../../../src-tauri/src/db/migrations/0002_seed_synonyms.sql?raw";

import { asciiLower, charLength, compareNoCase, equalsCi } from "@/web/backend/text";

/** trigram が索引を作れる最小の文字数。デスクトップ版はこれ未満の同義語を、長い語の候補に足さない */
const TRIGRAM_MIN_CHARS = 3;

/** 入力した 1 語と、同義語で広げた候補（先頭は入力した語）。 */
export interface TermGroup {
  original: string;
  alternatives: string[];
}

/** 語（ASCII を小文字にしたもの）から、同じグループの語の一覧を引く表。 */
export type SynonymIndex = ReadonlyMap<string, readonly string[]>;

/** `INSERT INTO synonyms (group_id, term) VALUES (1, '止血帯'), …;` の組を読む。 */
export function parseSynonymSeed(sql: string): SynonymIndex {
  const start = sql.indexOf("INSERT INTO synonyms ");
  if (start < 0) {
    throw new Error("同義語の初期値の SQL に INSERT INTO synonyms がありません");
  }
  const end = sql.indexOf(";", start);
  const values = sql.slice(start, end < 0 ? undefined : end);
  const groups = new Map<number, string[]>();
  for (const match of values.matchAll(/\(\s*(\d+)\s*,\s*'((?:[^']|'')*)'\s*\)/g)) {
    const [, id, term] = match;
    if (id === undefined || term === undefined) {
      continue;
    }
    const groupId = Number(id);
    const terms = groups.get(groupId) ?? [];
    terms.push(term.replaceAll("''", "'"));
    groups.set(groupId, terms);
  }
  if (groups.size === 0) {
    throw new Error("同義語の初期値の SQL から語を読めませんでした");
  }
  const index = new Map<string, string[]>();
  for (const terms of groups.values()) {
    // 同義語の列は COLLATE NOCASE で、デスクトップ版は ORDER BY term で返す
    const sorted = [...terms].sort(compareNoCase);
    for (const term of terms) {
      const key = asciiLower(term);
      const existing = index.get(key) ?? [];
      index.set(key, [...existing, ...sorted.filter((t) => !existing.some((e) => equalsCi(e, t)))]);
    }
  }
  return index;
}

export const SEED_SYNONYMS: SynonymIndex = parseSynonymSeed(seedSql);

/** 同義語辞書で語を広げる（デスクトップ版の search.rs の expand と同じ規則）。 */
export function expandTerm(term: string, index: SynonymIndex = SEED_SYNONYMS): TermGroup {
  const alternatives = [term];
  const originalIsShort = charLength(term) < TRIGRAM_MIN_CHARS;
  for (const synonym of index.get(asciiLower(term)) ?? []) {
    // 3 文字以上の語で探しているのに「CA」のような短い候補を足すと、無関係な語（cardiac など）に大量に当たる
    if (!originalIsShort && charLength(synonym) < TRIGRAM_MIN_CHARS) {
      continue;
    }
    if (!alternatives.some((a) => equalsCi(a, synonym))) {
      alternatives.push(synonym);
    }
  }
  return { original: term, alternatives };
}
