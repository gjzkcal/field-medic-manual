import { useEffect, useRef, type JSX } from "react";
import { useNavigate } from "react-router";

import { useOverlayUi } from "@/features/overlay/overlay-mode";
import { PrefsCommandGroups } from "@/features/prefs/PrefsCommandGroups";
import { usePalettePrefs } from "@/features/prefs/use-palette-prefs";
import { CommandPalette } from "@/features/search/CommandPalette";

/** 小窓の検索のタブ。結果は小窓の中で開く（ゲームから目を離さずに読めるように）。 */
export function OverlaySearchPage(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const focusRequest = useOverlayUi((s) => s.searchFocusRequest);
  const query = useOverlayUi((s) => s.searchQuery);
  const { onFavorite, isFavorite } = usePalettePrefs();

  // Ctrl+Shift+F で呼ばれたら入力欄へ。前の語は選択しておき、そのまま打てば置き換わるようにする
  useEffect(() => {
    if (focusRequest > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusRequest]);

  return (
    <CommandPalette
      variant="inline"
      inputRef={inputRef}
      query={query}
      onQueryChange={(searchQuery) => {
        useOverlayUi.setState({ searchQuery });
      }}
      className="h-full bg-transparent"
      onSelect={(href) => {
        void navigate(href);
      }}
      onFavorite={onFavorite}
      isFavorite={isFavorite}
      emptySlot={<PrefsCommandGroups />}
    />
  );
}
