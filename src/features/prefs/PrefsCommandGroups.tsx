import { useEffect, type JSX } from "react";

import { CommandGroup, CommandItem } from "@/components/ui/command";
import { PrefIcon } from "@/features/prefs/PrefIcon";
import { refreshPrefs, usePrefs } from "@/features/prefs/prefs-store";
import { PREF_KIND_LABELS, prefHref, prefKey } from "@/features/prefs/targets";
import { usePaletteOpen } from "@/features/search/palette-open";
import type { PrefItem } from "@/lib/bindings/PrefItem";

/**
 * 検索欄が空のときに出す、お気に入りと最近見たもの。検索結果と同じく ↑↓ と Enter で開ける。
 * 別のウィンドウで変わっているかもしれないので、出すたびに読み直す。
 */
export function PrefsCommandGroups(): JSX.Element {
  const favorites = usePrefs((s) => s.favorites);
  const history = usePrefs((s) => s.history);
  const error = usePrefs((s) => s.error);

  useEffect(() => {
    void refreshPrefs();
  }, []);

  if (favorites.length === 0 && history.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        {error === null
          ? "語を入力すると、マニュアルの節・トリアージのフロー・クイック表を探します。開いたものとお気に入り（Ctrl+Enter）はここに出ます。"
          : `お気に入りと履歴を読み込めませんでした: ${error}`}
      </p>
    );
  }
  return (
    <>
      {favorites.length > 0 && (
        <CommandGroup heading="お気に入り">
          {favorites.map((item) => (
            <PrefCommandItem key={prefKey(item.target)} group="fav" item={item} />
          ))}
        </CommandGroup>
      )}
      {history.length > 0 && (
        <CommandGroup heading="最近見たもの">
          {history.map((item) => (
            <PrefCommandItem key={prefKey(item.target)} group="recent" item={item} />
          ))}
        </CommandGroup>
      )}
    </>
  );
}

function PrefCommandItem({ group, item }: { group: string; item: PrefItem }): JSX.Element {
  const open = usePaletteOpen();
  return (
    <CommandItem
      // お気に入りと履歴の両方に同じ対象が出るので、グループ名を前に付けて cmdk の値を分ける
      value={`${group}:${prefKey(item.target)}`}
      onSelect={() => {
        open(prefHref(item.target));
      }}
      className="gap-3 [&>svg:last-child]:hidden"
    >
      <PrefIcon target={item.target} className="text-muted-foreground" />
      <span className="sr-only">{PREF_KIND_LABELS[item.target.kind]}</span>
      <span className="truncate font-medium">{item.title}</span>
      {item.context !== null && (
        <span className="ml-auto max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
          {item.context}
        </span>
      )}
    </CommandItem>
  );
}
