// お気に入りと「最近見たもの」。メインと小窓は別の WebView なので、それぞれがこのストアを持ち、
// 開いたとき（小窓は表示のたび）に DB から読み直す。
import { create } from "zustand";

import { prefKey } from "@/features/prefs/targets";
import type { PrefItem } from "@/lib/bindings/PrefItem";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";
import { errorMessage, favList, favToggle, historyList, historyPush } from "@/lib/tauri";

/** 検索欄が空のときに出す「最近見たもの」の数。小窓の高さでもお気に入りと並べて収まる程度 */
export const RECENT_LIMIT = 8;

interface PrefsState {
  favorites: PrefItem[];
  history: PrefItem[];
  error: string | null;
}

export const usePrefs = create<PrefsState>()(() => ({ favorites: [], history: [], error: null }));

/** 読めなければ前の一覧を残してエラーだけ持つ（一覧が一瞬で消えると、押そうとした項目がずれるため）。 */
export async function refreshPrefs(): Promise<void> {
  try {
    const [favorites, history] = await Promise.all([favList(), historyList(RECENT_LIMIT)]);
    usePrefs.setState({ favorites, history, error: null });
  } catch (error: unknown) {
    usePrefs.setState({ error: errorMessage(error) });
  }
}

/** お気に入りに入れたら true、外したら false。題名は Rust が引くので、切り替えたあと一覧ごと読み直す。 */
export async function toggleFavorite(target: PrefTarget): Promise<boolean> {
  const on = await favToggle(target);
  await refreshPrefs();
  return on;
}

/** 開いたものを履歴に積む。失敗しても閲覧は続けられるので、知らせない。 */
export function recordHistory(target: PrefTarget): void {
  historyPush(target).catch(() => {
    // 履歴は補助の機能なので、書けなくても画面は止めない
  });
}

export function useIsFavorite(target: PrefTarget): boolean {
  const key = prefKey(target);
  return usePrefs((s) => s.favorites.some((f) => prefKey(f.target) === key));
}
