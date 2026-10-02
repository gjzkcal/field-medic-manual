// 検索パレットの絞り込み。settings テーブルのキー `search` に保存し、再起動しても残す
// （「Core しか使わない」などを一度選べば済むようにするため）。
// 版（Release / Dev）では絞らない。同梱の原稿はすべて Dev 版向けで、Release を選んでも 0 件になるだけのため。
import { create } from "zustand";

import { isModTarget, MOD_TARGET_VALUES } from "@/features/content/meta";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { SearchFilter } from "@/lib/bindings/SearchFilter";
import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

export interface SearchFilterSettings {
  modTargets: ModTarget[];
  tags: string[];
}

export const EMPTY_SEARCH_FILTER: SearchFilterSettings = {
  modTargets: [],
  tags: [],
};

const SETTINGS_KEY = "search";

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * 保存された値を読む。項目ごとに検査し、不正な項目だけ既定値に戻す（1 項目の誤りで他の設定を失わないため）。
 * 以前の版で保存した modChannel は読まない。画面から解除できないまま検索が絞られ続けないようにするため
 */
export function parseSearchFilter(value: unknown): SearchFilterSettings {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const modTargets = stringsOf(record["modTargets"]).filter(isModTarget);
  return {
    // 並びを固定しておくと、同じ条件のときに検索し直さずに済む（依存の比較が文字列で一致するため）
    modTargets: MOD_TARGET_VALUES.filter((t) => modTargets.includes(t)),
    tags: [...new Set(stringsOf(record["tags"]).map((t) => t.trim()))].filter((t) => t !== ""),
  };
}

/** search_query に渡す形。空の条件は省く（Rust 側で「条件なし」と「0 件に一致」を区別するため）。 */
export function toQueryFilter(settings: SearchFilterSettings): SearchFilter {
  const filter: SearchFilter = {};
  if (settings.modTargets.length > 0) {
    filter.modTargets = settings.modTargets;
  }
  if (settings.tags.length > 0) {
    filter.tags = settings.tags;
  }
  return filter;
}

export function activeFilterCount(settings: SearchFilterSettings): number {
  return settings.modTargets.length + settings.tags.length;
}

interface SearchFilterState {
  filter: SearchFilterSettings;
  /** 利用者が変えたか。読み込みより先に変えられたとき、読み込んだ古い値で上書きしないため */
  changed: boolean;
  storageError: string | null;
  update: (patch: Partial<SearchFilterSettings>) => void;
}

export const useSearchFilter = create<SearchFilterState>()((set, get) => ({
  filter: EMPTY_SEARCH_FILTER,
  changed: false,
  storageError: null,
  update: (patch) => {
    const filter = parseSearchFilter({ ...get().filter, ...patch });
    set({ filter, changed: true });
    settingsSet(SETTINGS_KEY, filter).then(
      () => {
        set({ storageError: null });
      },
      (error: unknown) => {
        set({ storageError: errorMessage(error) });
      },
    );
  },
}));

/**
 * 保存した絞り込みを読み込む。起動時に 1 回呼ぶ。読めなければ絞り込みなしで検索できるようにする。
 * force は、別のウィンドウで変えた値を拾うとき（小窓を出すたび）
 */
export async function loadSearchFilter(force = false): Promise<void> {
  try {
    const filter = parseSearchFilter(await settingsGet(SETTINGS_KEY));
    if (force || !useSearchFilter.getState().changed) {
      useSearchFilter.setState({ filter });
    }
  } catch (error: unknown) {
    useSearchFilter.setState({ storageError: errorMessage(error) });
  }
}
