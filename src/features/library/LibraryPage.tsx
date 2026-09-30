import { LayoutGridIcon, ListIcon } from "lucide-react";
import { useEffect, useMemo, useState, type JSX } from "react";
import { Link } from "react-router";

import { revealMainWindow } from "@/app/reveal";
import { IssueCard } from "@/components/IssueCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MOD_CHANNEL_LABELS, MOD_TARGET_LABELS, MOD_TARGET_VALUES } from "@/features/content/meta";
import { useContentSync } from "@/features/content/sync";
import { DocMetaBadges } from "@/features/library/DocMetaBadges";
import { DocTags } from "@/features/library/DocTags";
import {
  EMPTY_FILTER,
  filterDocs,
  isFiltering,
  sortDocs,
  type LibraryFilter,
  type LibrarySort,
} from "@/features/library/library-filter";
import { SyncStatusCard } from "@/features/sync/SyncStatusCard";
import { useSyncedLoad } from "@/features/sync/use-synced-load";
import { useNow } from "@/hooks/use-now";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import { docList, errorMessage } from "@/lib/tauri";

type ViewMode = "card" | "list";
const MOD_CHANNELS: readonly ModChannel[] = ["release", "dev"];
const SORT_LABELS: Record<LibrarySort, string> = {
  order: "標準",
  title: "タイトル",
  updated: "更新日",
};
const SORTS: readonly LibrarySort[] = ["order", "title", "updated"];
// 読めないあいだに毎回新しい配列を作らず、並べ替えのメモ化を効かせるため
const NO_DOCS: DocSummary[] = [];

type LoadState =
  | { status: "loading" }
  | { status: "ready"; docs: DocSummary[] }
  | { status: "error"; message: string };

function useDocList(): LoadState {
  const load = useSyncedLoad(useContentSync, "list", docList);
  switch (load.status) {
    case "loading":
      return load;
    case "ready":
      return { status: "ready", docs: load.value };
    case "error":
      return { status: "error", message: errorMessage(load.error) };
  }
}

export function LibraryPage(): JSX.Element {
  const state = useDocList();
  const now = useNow();
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<LibrarySort>("order");
  const [view, setView] = useState<ViewMode>("card");

  const loaded = state.status !== "loading";
  // 起動時はこの一覧が最初の画面なので、描き終えてからメインを出す
  useEffect(() => {
    if (loaded) {
      void revealMainWindow();
    }
  }, [loaded]);

  const docs = state.status === "ready" ? state.docs : NO_DOCS;
  const shown = useMemo(
    () => sortDocs(filterDocs(docs, filter, now), sort),
    [docs, filter, now, sort],
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">ライブラリ</h1>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[view]}
          onValueChange={(values) => {
            // 選択中の項目を押すと空になるので、そのときは切り替えない
            if (values.includes("list")) {
              setView("list");
            } else if (values.includes("card")) {
              setView("card");
            }
          }}
        >
          <ToggleGroupItem value="card" aria-label="カード表示">
            <LayoutGridIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="リスト表示">
            <ListIcon />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <SyncStatusCard
        store={useContentSync}
        syncingText="マニュアルを準備しています…"
        errorTitle="マニュアルを準備できませんでした"
        failedTitle="一部のマニュアルを更新できませんでした"
        failedDetail="前回の内容を表示しています。"
        warningsTitle="原稿の警告（開発ビルドのみ）"
      />
      {state.status === "loading" && <Skeleton className="h-32 w-full" />}
      {state.status === "error" && (
        <IssueCard title="一覧を読み込めませんでした" detail={state.message} issues={[]} />
      )}
      {state.status === "ready" && (
        <>
          <FilterBar
            docs={docs}
            filter={filter}
            onFilterChange={setFilter}
            sort={sort}
            onSortChange={setSort}
          />
          <p className="text-sm text-muted-foreground">
            {shown.length} 件{isFiltering(filter) && `（全 ${String(docs.length)} 件）`}
          </p>
          {shown.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>
                  {docs.length === 0
                    ? "マニュアルがありません"
                    : "条件に合うマニュアルがありません"}
                </EmptyTitle>
                <EmptyDescription>
                  {docs.length === 0
                    ? "起動時の準備が終わると表示されます。"
                    : "絞り込みの条件を変えてください。"}
                </EmptyDescription>
              </EmptyHeader>
              {isFiltering(filter) && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilter(EMPTY_FILTER);
                    }}
                  >
                    絞り込みを解除
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : view === "card" ? (
            <DocCards docs={shown} now={now} />
          ) : (
            <DocRows docs={shown} now={now} />
          )}
        </>
      )}
    </section>
  );
}

interface FilterBarProps {
  docs: readonly DocSummary[];
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
}

function FilterBar({
  docs,
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: FilterBarProps): JSX.Element {
  // 原稿にないモジュールやタグを並べても選んだ結果が 0 件になるだけなので、原稿にあるものだけ出す
  const modTargets = MOD_TARGET_VALUES.filter((t) => docs.some((d) => d.meta.modTarget === t));
  const tags = [...new Set(docs.flatMap((d) => d.meta.tags))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <FilterRow label="モジュール">
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={[...filter.modTargets]}
          onValueChange={(values) => {
            // ToggleGroup は string[] を返すので、既知の値だけを残して型を戻す
            onFilterChange({ ...filter, modTargets: modTargets.filter((t) => values.includes(t)) });
          }}
        >
          {modTargets.map((t) => (
            <ToggleGroupItem key={t} value={t}>
              {MOD_TARGET_LABELS[t]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FilterRow>
      <FilterRow label="版">
        <ToggleGroup
          variant="outline"
          size="sm"
          value={filter.channel === null ? [] : [filter.channel]}
          onValueChange={(values) => {
            onFilterChange({
              ...filter,
              channel: MOD_CHANNELS.find((c) => values.includes(c)) ?? null,
            });
          }}
        >
          {MOD_CHANNELS.map((c) => (
            <ToggleGroupItem key={c} value={c}>
              {MOD_CHANNEL_LABELS[c]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">版を問わない原稿は常に表示</span>
      </FilterRow>
      {tags.length > 0 && (
        <FilterRow label="タグ">
          <ToggleGroup
            multiple
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={[...filter.tags]}
            onValueChange={(values) => {
              onFilterChange({ ...filter, tags: tags.filter((t) => values.includes(t)) });
            }}
          >
            {tags.map((t) => (
              <ToggleGroupItem key={t} value={t}>
                {t}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FilterRow>
      )}
      <FilterRow label="確認日">
        <Toggle
          variant="outline"
          size="sm"
          pressed={filter.staleOnly}
          onPressedChange={(pressed) => {
            onFilterChange({ ...filter, staleOnly: pressed });
          }}
        >
          古い内容だけ（90 日超・確認日なし）
        </Toggle>
      </FilterRow>
      <FilterRow label="並び順">
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[sort]}
          onValueChange={(values) => {
            const next = SORTS.find((s) => values.includes(s));
            if (next !== undefined) {
              onSortChange(next);
            }
          }}
        >
          {SORTS.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {SORT_LABELS[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function DocCards({ docs, now }: { docs: readonly DocSummary[]; now: Date }): JSX.Element {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {docs.map((doc) => (
        <li key={doc.id}>
          <Link
            to={`/doc/${doc.id}`}
            className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">{doc.title}</CardTitle>
                <CardDescription>{doc.sectionCount} 節</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <DocMetaBadges meta={doc.meta} now={now} />
                <DocTags tags={doc.meta.tags} />
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DocRows({ docs, now }: { docs: readonly DocSummary[]; now: Date }): JSX.Element {
  return (
    <ul className="divide-y rounded-xl border">
      {docs.map((doc) => (
        <li key={doc.id}>
          <Link
            to={`/doc/${doc.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="min-w-40 flex-1 text-base font-semibold">{doc.title}</span>
            <DocTags tags={doc.meta.tags} />
            <DocMetaBadges meta={doc.meta} now={now} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
