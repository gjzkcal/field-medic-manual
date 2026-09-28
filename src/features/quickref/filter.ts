// クイック表の画面の絞り込み。状態は URL のクエリに持つ（小窓の「メインで開く」で同じ表示を引き継ぐため）。
import { isRowVisible } from "@/features/quickref/conditions";
import { SEVERITIES, type Severity } from "@/features/quickref/severity";
import type { ActiveMods } from "@/features/triage/runner";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";

export interface QuickrefFilters {
  /** null = すべて */
  category: string | null;
  /** 空 = すべて */
  severities: readonly Severity[];
  keyword: string;
  /** 使っている MOD に合わない行も出す */
  showAll: boolean;
  /** 検索・お気に入り・リンクから指された行 */
  rowId: string | null;
}

const CATEGORY = "cat";
const SEVERITY = "sev";
const KEYWORD = "q";
const SHOW_ALL = "all";
const ROW = "row";

export function parseFilters(params: URLSearchParams): QuickrefFilters {
  const severities = new Set((params.get(SEVERITY) ?? "").split(",").map(Number));
  return {
    category: params.get(CATEGORY),
    severities: SEVERITIES.filter((s) => severities.has(s)),
    keyword: params.get(KEYWORD) ?? "",
    showAll: params.get(SHOW_ALL) === "1",
    rowId: params.get(ROW),
  };
}

/** 既定値の項目は書かない（URL を短く保ち、何も絞っていないときは /quickref だけにするため） */
export function filtersToParams(filters: QuickrefFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.category !== null) {
    params.set(CATEGORY, filters.category);
  }
  if (filters.severities.length > 0) {
    params.set(SEVERITY, SEVERITIES.filter((s) => filters.severities.includes(s)).join(","));
  }
  if (filters.keyword !== "") {
    params.set(KEYWORD, filters.keyword);
  }
  if (filters.showAll) {
    params.set(SHOW_ALL, "1");
  }
  if (filters.rowId !== null) {
    params.set(ROW, filters.rowId);
  }
  return params;
}

export interface VisibleRow {
  row: QuickrefRow;
  /** 使っている MOD では出ない行（「すべての組み合わせ」か、行を指して開いたときだけ出る） */
  hiddenByMods: boolean;
}

function matchesKeyword(row: QuickrefRow, keyword: string): boolean {
  const terms = keyword
    .toLowerCase()
    .split(/\s+/u)
    .filter((t) => t !== "");
  if (terms.length === 0) {
    return true;
  }
  const text = [row.category, row.symptom, ...row.treatment, ...row.items, row.notes ?? ""]
    .join("\n")
    .toLowerCase();
  return terms.every((t) => text.includes(t));
}

export function visibleRows(
  rows: readonly QuickrefRow[],
  filters: QuickrefFilters,
  active: ActiveMods,
): VisibleRow[] {
  const target = filters.rowId === null ? undefined : rows.find((r) => r.id === filters.rowId);
  return rows.flatMap((row) => {
    const hiddenByMods = !isRowVisible(row, active);
    // 行を指して開いたときは、前に選んでいた絞り込みでその行が隠れないよう、絞り込みを外す
    if (target !== undefined) {
      return row === target || !hiddenByMods || filters.showAll ? [{ row, hiddenByMods }] : [];
    }
    const shown =
      (filters.showAll || !hiddenByMods) &&
      (filters.category === null || row.category === filters.category) &&
      (filters.severities.length === 0 || filters.severities.some((s) => s === row.severity)) &&
      matchesKeyword(row, filters.keyword);
    return shown ? [{ row, hiddenByMods }] : [];
  });
}

/** タブに並べるカテゴリ（ファイルに出てきた順） */
export function categoriesOf(rows: readonly QuickrefRow[]): string[] {
  return [...new Set(rows.map((r) => r.category))];
}
