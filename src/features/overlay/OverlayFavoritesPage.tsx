import { useEffect, useRef, type JSX, type RefObject } from "react";
import { Link } from "react-router";

import { usePageTitle } from "@/app/use-page-title";
import { focusTarget } from "@/app/use-route-focus";
import { IssueCard } from "@/components/IssueCard";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FavoriteButton } from "@/features/prefs/FavoriteButton";
import { PrefIcon } from "@/features/prefs/PrefIcon";
import { refreshPrefs, usePrefs } from "@/features/prefs/prefs-store";
import { PREF_KIND_LABELS, prefHref, prefKey } from "@/features/prefs/targets";

/** 小窓の ★ タブ。お気に入りを開く・外す。 */
export function OverlayFavoritesPage(): JSX.Element {
  usePageTitle("お気に入り");
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <>
      {/* 小窓は高さを惜しんで見出しを見せないが、画面の名前は読み上げで分かるようにする */}
      <h1 ref={headingRef} className="sr-only">
        お気に入り
      </h1>
      <FavoritesBody headingRef={headingRef} />
    </>
  );
}

function FavoritesBody({
  headingRef,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
}): JSX.Element {
  const favorites = usePrefs((s) => s.favorites);
  const error = usePrefs((s) => s.error);
  const listRef = useRef<HTMLUListElement>(null);
  // 星を押した行。外すと行ごと消えてフォーカスが body に落ちるので、一覧が描き直されたら近くの行へ移す
  const pendingRef = useRef<{ key: string; index: number } | null>(null);

  useEffect(() => {
    void refreshPrefs();
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending === null || favorites.some((f) => prefKey(f.target) === pending.key)) {
      return;
    }
    const links = listRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? [];
    const next = links[Math.min(pending.index, links.length - 1)] ?? headingRef.current;
    if (next !== null) {
      focusTarget(next);
    }
  }, [favorites, headingRef]);

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
    <ul ref={listRef} className="flex flex-col gap-1">
      {favorites.map((item, index) => (
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
          <span
            className="contents"
            onClickCapture={() => {
              pendingRef.current = { key: prefKey(item.target), index };
            }}
          >
            <FavoriteButton target={item.target} label={`「${item.title}」`} />
          </span>
        </li>
      ))}
    </ul>
  );
}
