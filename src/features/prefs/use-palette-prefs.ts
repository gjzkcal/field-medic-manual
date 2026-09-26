// 検索パレット（メインの上部の検索欄と小窓）に、お気に入りの切り替え（Ctrl+Enter）と星の表示をつなぐ。
import { useCallback, useMemo } from "react";

import { toggleFavorite, usePrefs } from "@/features/prefs/prefs-store";
import { prefKey } from "@/features/prefs/targets";
import { searchKind } from "@/features/search/kinds";
import type { SearchHit } from "@/lib/bindings/SearchHit";

export interface PalettePrefs {
  onFavorite: (hit: SearchHit) => void;
  isFavorite: (hit: SearchHit) => boolean;
}

export function usePalettePrefs(): PalettePrefs {
  const favorites = usePrefs((s) => s.favorites);
  const keys = useMemo(() => new Set(favorites.map((f) => prefKey(f.target))), [favorites]);
  const onFavorite = useCallback((hit: SearchHit) => {
    toggleFavorite(searchKind(hit.kind).favoriteTarget(hit)).catch(() => {
      // 失敗したら星が変わらないので、利用者はそれで気づける。パレットの操作は止めない
    });
  }, []);
  const isFavorite = useCallback(
    (hit: SearchHit) => keys.has(prefKey(searchKind(hit.kind).favoriteTarget(hit))),
    [keys],
  );
  return { onFavorite, isFavorite };
}
