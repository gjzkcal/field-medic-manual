// Web 版の検索。デスクトップ版の Rust（src-tauri/src/db/search.rs）の LIKE の経路を移したもの。
// デスクトップ版は 3 文字以上の語を FTS5 の bm25 で並べるが、Web 版はすべての語を部分一致で探して当たった場所で並べる
// （原稿は数十本なので全件を見ても十分速く、全文索引のライブラリを足さずに済むため）。そのため 3 文字以上の語では並びが変わることがある。
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { QuickrefHit } from "@/lib/bindings/QuickrefHit";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";
import type { SearchFilter } from "@/lib/bindings/SearchFilter";
import type { SearchHit } from "@/lib/bindings/SearchHit";
import type { Section } from "@/lib/bindings/Section";
import type { SectionHit } from "@/lib/bindings/SectionHit";
import type { SearchOptions } from "@/lib/tauri";
import { sectionKeywords, type WebStore } from "@/web/backend/store";
import {
  expandTerm,
  SEED_SYNONYMS,
  type SynonymIndex,
  type TermGroup,
} from "@/web/backend/synonyms";
import {
  compareBinary,
  containsCi,
  equalsCi,
  firstNonZero,
  makeSnippet,
  normalizeTags,
  splitTerms,
} from "@/web/backend/text";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** 同義語でだけ当たった行の点に掛ける係数（並びは別に「元の語の行が先」と決めるので、返す点を低く見せるだけ） */
const SYNONYM_PENALTY = 0.8;
const SNIPPET_CONTEXT_CHARS = 20;

/**
 * 節とクイック表を検索する。
 * 並びは「症状に当たったクイック表の行 → 節 → 本文だけに当たった行」。Web 版にはトリアージのフローがないので出さない。
 */
export function searchStore(
  store: WebStore,
  query: string,
  options: SearchOptions = {},
  synonyms: SynonymIndex = SEED_SYNONYMS,
): SearchHit[] {
  const terms = splitTerms(query);
  if (terms.length === 0) {
    return [];
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const filter = options.filter ?? {};
  const groups = terms.map((t) => expandTerm(t, synonyms));
  const alternatives = groups.flatMap((g) => g.alternatives);

  const sections = searchSections(store, groups, alternatives, filter).slice(0, limit);
  const rows = searchQuickref(store, groups, alternatives, filter).slice(0, limit);
  // 症状に当たった行は「この症状ならこれ」の答えそのものなので最も上に置く
  return [
    ...rows.filter((r) => r.symptomMatch).map((r) => r.hit),
    ...sections,
    ...rows.filter((r) => !r.symptomMatch).map((r) => r.hit),
  ].slice(0, limit);
}

function foundIn(group: TermGroup, text: string): boolean {
  return group.alternatives.some((a) => containsCi(text, a));
}

interface Candidate {
  doc: DocDetail;
  section: Section;
  keywords: string;
  titleMatch: boolean;
}

function searchSections(
  store: WebStore,
  groups: readonly TermGroup[],
  alternatives: readonly string[],
  filter: SearchFilter,
): SearchHit[] {
  const tags = normalizeTags(filter.tags ?? []);
  const candidates: Candidate[] = [];
  for (const doc of store.docs) {
    if (!docMatchesFilter(doc, filter)) {
      continue;
    }
    for (const section of doc.sections) {
      const keywords = sectionKeywords(section);
      const fields = [section.title, keywords, section.plainText];
      if (!groups.every((g) => fields.some((f) => foundIn(g, f)))) {
        continue;
      }
      // 文書のタグか節のタグのどちらかに、選んだタグがすべて付いている節に絞る
      const sectionTags = [...doc.meta.tags, ...section.tags];
      if (!tags.every((tag) => sectionTags.some((t) => equalsCi(t, tag)))) {
        continue;
      }
      candidates.push({
        doc,
        section,
        keywords,
        titleMatch: groups.every((g) => foundIn(g, section.title)),
      });
    }
  }
  // デスクトップ版の SQL の並び（タイトルに当たった節が先、文書のタイトル、節の順）
  candidates.sort((a, b) =>
    firstNonZero(
      Number(b.titleMatch) - Number(a.titleMatch),
      compareBinary(a.doc.title, b.doc.title),
      a.section.orderIndex - b.section.orderIndex,
    ),
  );
  const hits = candidates.map((c) => toSectionHit(c, groups, alternatives));
  // 利用者が打った語そのものを含む節を必ず先に見せるため、同義語だけの当たりを後ろにする（sort は安定）
  hits.sort((a, b) =>
    firstNonZero(Number(a.synonymOnly) - Number(b.synonymOnly), b.score - a.score),
  );
  return hits.map((hit) => ({ kind: "section", ...hit }));
}

function docMatchesFilter(doc: DocDetail, filter: SearchFilter): boolean {
  const targets = filter.modTargets ?? [];
  // 空の配列は「条件なし」（何も選んでいない絞り込みから来るため）
  if (
    targets.length > 0 &&
    (doc.meta.modTarget === null || !targets.includes(doc.meta.modTarget))
  ) {
    return false;
  }
  // 版を問わない原稿（null）はどちらの版でも読めるので含める
  return (
    filter.modChannel === undefined ||
    doc.meta.modChannel === null ||
    doc.meta.modChannel === filter.modChannel
  );
}

function toSectionHit(
  c: Candidate,
  groups: readonly TermGroup[],
  alternatives: readonly string[],
): SectionHit {
  const contains = (term: string): boolean =>
    containsCi(c.section.title, term) ||
    containsCi(c.keywords, term) ||
    containsCi(c.section.plainText, term);
  const synonymOnly = groups.some((g) => !contains(g.original));
  const matchedTerms: string[] = [];
  for (const term of alternatives.filter(contains)) {
    // 語をまたいで同じ候補が出ることがある（「止血 止血帯」と同義語の展開など）
    if (!matchedTerms.some((m) => equalsCi(m, term))) {
      matchedTerms.push(term);
    }
  }
  // 部分一致には関連度がないので、どこに当たったかで点を付ける（タイトル一致を優先する仕様のため）
  let score = 1;
  if (c.titleMatch) {
    score += 2;
  }
  if (groups.every((g) => foundIn(g, c.keywords))) {
    score += 1;
  }
  return {
    id: c.section.id,
    title: c.section.title,
    snippet: makeSnippet(c.section.plainText, alternatives, SNIPPET_CONTEXT_CHARS),
    score: synonymOnly ? score * SYNONYM_PENALTY : score,
    documentId: c.doc.id,
    documentTitle: c.doc.title,
    anchor: c.section.anchor,
    synonymOnly,
    matchedTerms,
  };
}

/** 検索用の本文（デスクトップ版の quickref_rows.search_text と同じ）。症状とカテゴリは別に探す。 */
function quickrefSearchText(row: QuickrefRow): string {
  return [...row.treatment, ...row.items, ...(row.notes === null ? [] : [row.notes])].join("\n");
}

function searchQuickref(
  store: WebStore,
  groups: readonly TermGroup[],
  alternatives: readonly string[],
  filter: SearchFilter,
): { symptomMatch: boolean; hit: SearchHit }[] {
  // クイック表の行にタグはないので、タグで絞り込んでいるときは出さない
  if (normalizeTags(filter.tags ?? []).length > 0) {
    return [];
  }
  const table = store.quickref;
  if (
    filter.modChannel !== undefined &&
    table.modChannel !== null &&
    table.modChannel !== filter.modChannel
  ) {
    return [];
  }
  const targets = filter.modTargets ?? [];
  const found: { symptomMatch: boolean; hit: SearchHit }[] = [];
  for (const row of table.rows) {
    // 条件のない行はどの組み合わせでも出るので、絞り込みでは Core の行として扱う
    const rowTargets: readonly ModTarget[] = row.mods.length > 0 ? row.mods : ["core"];
    if (targets.length > 0 && !rowTargets.some((t) => targets.includes(t))) {
      continue;
    }
    const searchText = quickrefSearchText(row);
    const fields = [row.symptom, row.category, searchText];
    if (!groups.every((g) => fields.some((f) => foundIn(g, f)))) {
      continue;
    }
    // カテゴリだけの当たりは含めない（「出血」でカテゴリの全行が節より上に並ばないように）
    const symptomMatch = groups.every((g) => foundIn(g, row.symptom));
    const synonymOnly = groups.some((g) => !fields.some((f) => containsCi(f, g.original)));
    const score = symptomMatch ? 3 : 1;
    const hit: QuickrefHit = {
      id: row.id,
      title: row.symptom,
      category: row.category,
      severity: row.severity,
      mods: row.mods,
      withoutMods: row.withoutMods,
      snippet: makeSnippet(searchText, alternatives, SNIPPET_CONTEXT_CHARS),
      score: synonymOnly ? score * SYNONYM_PENALTY : score,
      synonymOnly,
    };
    found.push({ symptomMatch, hit: { kind: "quickref", ...hit } });
  }
  // 同じ段の中はファイルに書いた順（作者が重要な順に並べている）のまま、同義語だけの行を後ろに回す
  found.sort((a, b) => Number(synonymOnlyOf(a.hit)) - Number(synonymOnlyOf(b.hit)));
  return found;
}

function synonymOnlyOf(hit: SearchHit): boolean {
  return hit.synonymOnly;
}
