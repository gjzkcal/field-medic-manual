import { useEffect, type JSX } from "react";
import { Link } from "react-router";

import { IssueCard } from "@/components/IssueCard";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FavoriteButton } from "@/features/prefs/FavoriteButton";
import { PrefIcon } from "@/features/prefs/PrefIcon";
import { refreshPrefs, usePrefs } from "@/features/prefs/prefs-store";
import { PREF_KIND_LABELS, prefHref, prefKey } from "@/features/prefs/targets";

/** 小窓の ★ タブ。お気に入りを開く・外す。 */
export function OverlayFavoritesPage(): JSX.Element {
  const favorites = usePrefs((s) => s.favorites);
  const error = usePrefs((s) => s.error);

  useEffect(() => {
    void refreshPrefs();
  }, []);

  if (error !== null && favorites.length === 0) {
    return <IssueCard title="お気に入りを読み込めませんでした" detail={error} issues={[]} />;
  }
  if (favorites.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>お気に入りはまだありません</EmptyTitle>
          <EmptyDescription>
            マニュアルやフローの ☆ を押すか、検索結果で Ctrl+Enter を押すと、ここに出ます。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {favorites.map((item) => (
        <li key={prefKey(item.target)} className="flex items-center gap-1">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to={prefHref(item.target)} />}
            className="h-auto min-w-0 flex-1 justify-start gap-3 py-2 text-left"
          >
            <PrefIcon target={item.target} className="text-muted-foreground" />
            <span className="sr-only">{PREF_KIND_LABELS[item.target.kind]}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{item.title}</span>
              {item.context !== null && (
                <span className="truncate text-xs text-muted-foreground">{item.context}</span>
              )}
            </span>
          </Button>
          <FavoriteButton target={item.target} label={`「${item.title}」`} />
        </li>
      ))}
    </ul>
  );
}
