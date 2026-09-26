import { LayoutGridIcon, ListIcon } from "lucide-react";
import { useEffect, useMemo, useState, type JSX } from "react";
import { Link } from "react-router";

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
import { useContentSync, type SyncIssue } from "@/features/content/sync";
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
import { useNow } from "@/hooks/use-now";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import { docList, errorMessage } from "@/lib/tauri";

type ViewMode = "card" | "list";
const MOD_CHANNELS: readonly ModChannel[] = ["release", "dev"];
const SORT_LABELS: Record<LibrarySort, string> = { updated: "更新日", title: "タイトル" };
const SORTS: readonly LibrarySort[] = ["updated", "title"];

type LoadState =
  | { status: "loading" }
  | { status: "ready"; docs: DocSummary[] }
  | { status: "error"; message: string };

function useDocList(): LoadState {
  const syncStatus = useContentSync((s) => s.state.status);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // 起動直後は同期の途中なので、同期が終わったら読み直して最新の一覧にする
  useEffect(() => {
    let cancelled = false;
    docList().then(
      (docs) => {
        if (!cancelled) {
          setState({ status: "ready", docs });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: errorMessage(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [syncStatus]);
  return state;
}

export function LibraryPage(): JSX.Element {
  const state = useDocList();
  const now = useNow();
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<LibrarySort>("title");
  const [view, setView] = useState<ViewMode>("card");

  const docs = useMemo(() => (state.status === "ready" ? state.docs : []), [state]);
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
      <SyncStatus />
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

/** 起動時の同期で問題があったときだけ出す。うまくいったときは何も出さない（毎回の起動で目障りにならないように）。 */
function SyncStatus(): JSX.Element | null {
  const state = useContentSync((s) => s.state);
  if (state.status === "syncing") {
    return <p className="text-sm text-muted-foreground">マニュアルを準備しています…</p>;
  }
  if (state.status === "error") {
    return (
      <IssueCard title="マニュアルを準備できませんでした" issues={[]} detail={state.message} />
    );
  }
  if (state.status !== "done") {
    return null;
  }
  const { failed, warnings } = state.result;
  if (failed.length > 0) {
    return (
      <IssueCard
        title="一部のマニュアルを更新できませんでした"
        detail="前回の内容を表示しています。"
        issues={failed}
      />
    );
  }
  // 原稿の書き間違いは作者が直すものなので、開発ビルドでだけ見せる（pnpm test の原稿の検査でも見つかる）
  if (import.meta.env.DEV && warnings.length > 0) {
    return <IssueCard title="原稿の警告（開発ビルドのみ）" detail="" issues={warnings} />;
  }
  return null;
}

interface IssueCardProps {
  title: string;
  detail: string;
  issues: readonly SyncIssue[];
}

function IssueCard({ title, detail, issues }: IssueCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        {detail !== "" && <CardDescription>{detail}</CardDescription>}
      </CardHeader>
      {issues.length > 0 && (
        <CardContent>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {issues.map((issue) => (
              <li key={`${issue.fileName}:${issue.message}`}>
                {issue.fileName}: {issue.message}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
