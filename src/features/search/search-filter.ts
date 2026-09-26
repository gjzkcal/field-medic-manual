// 検索パレットの絞り込み。settings テーブルのキー `search` に保存し、再起動しても残す
// （「Release しか使わない」などを一度選べば済むようにするため）。
import { create } from "zustand";

import { isModChannel, isModTarget, MOD_TARGET_VALUES } from "@/features/content/meta";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { SearchFilter } from "@/lib/bindings/SearchFilter";
import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

export interface SearchFilterSettings {
  modTargets: ModTarget[];
  modChannel: ModChannel | null;
  tags: string[];
}

export const EMPTY_SEARCH_FILTER: SearchFilterSettings = {
  modTargets: [],
  modChannel: null,
  tags: [],
};

const SETTINGS_KEY = "search";

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** 保存された値を読む。項目ごとに検査し、不正な項目だけ既定値に戻す（1 項目の誤りで他の設定を失わないため）。 */
export function parseSearchFilter(value: unknown): SearchFilterSettings {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const modTargets = stringsOf(record["modTargets"]).filter(isModTarget);
  const channel = record["modChannel"];
  return {
    // 並びを固定しておくと、同じ条件のときに検索し直さずに済む（依存の比較が文字列で一致するため）
    modTargets: MOD_TARGET_VALUES.filter((t) => modTargets.includes(t)),
    modChannel: typeof channel === "string" && isModChannel(channel) ? channel : null,
    tags: [...new Set(stringsOf(record["tags"]).map((t) => t.trim()))].filter((t) => t !== ""),
  };
}

/** search_query に渡す形。空の条件は省く（Rust 側で「条件なし」と「0 件に一致」を区別するため）。 */
export function toQueryFilter(settings: SearchFilterSettings): SearchFilter {
  const filter: SearchFilter = {};
  if (settings.modTargets.length > 0) {
    filter.modTargets = settings.modTargets;
  }
  if (settings.modChannel !== null) {
    filter.modChannel = settings.modChannel;
  }
  if (settings.tags.length > 0) {
    filter.tags = settings.tags;
  }
  return filter;
}

export function activeFilterCount(settings: SearchFilterSettings): number {
  return settings.modTargets.length + (settings.modChannel === null ? 0 : 1) + settings.tags.length;
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

/** 保存した絞り込みを読み込む。起動時に 1 回呼ぶ。読めなければ絞り込みなしで検索できるようにする。 */
export async function loadSearchFilter(): Promise<void> {
  try {
    const filter = parseSearchFilter(await settingsGet(SETTINGS_KEY));
    if (!useSearchFilter.getState().changed) {
      useSearchFilter.setState({ filter });
    }
  } catch (error: unknown) {
    useSearchFilter.setState({ storageError: errorMessage(error) });
  }
}
