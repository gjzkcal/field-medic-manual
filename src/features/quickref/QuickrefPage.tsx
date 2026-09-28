import { SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, type JSX } from "react";
import { useSearchParams } from "react-router";

import { IssueCard } from "@/components/IssueCard";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isStale } from "@/features/library/stale";
import { recordHistory } from "@/features/prefs/prefs-store";
import {
  categoriesOf,
  filtersToParams,
  parseFilters,
  visibleRows,
  type QuickrefFilters,
} from "@/features/quickref/filter";
import { rowElementId } from "@/features/quickref/link";
import { QuickrefCard } from "@/features/quickref/QuickrefCard";
import {
  QUICKREF_VIEWS,
  useQuickrefSettings,
  type QuickrefView,
} from "@/features/quickref/quickref-settings";
import { QuickrefTableView } from "@/features/quickref/QuickrefTableView";
import { SEVERITIES, SEVERITY_BADGE_CLASSES, severityName } from "@/features/quickref/severity";
import { useQuickrefSync } from "@/features/quickref/sync";
import { useQuickrefTable } from "@/features/quickref/use-quickref";
import { activeMods, modSummary, useModSettings } from "@/features/settings/mod-settings";
import { useNow } from "@/hooks/use-now";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";

const ALL_CATEGORIES = "all";
const VIEW_LABELS: Record<QuickrefView, string> = { card: "カード", table: "表" };

interface QuickrefPageProps {
  /** 小窓（幅 420px）。見出しと表の表示を省き、カードだけにする */
  compact?: boolean;
}

/** 症状→処置のクイック表（Step 06）。絞り込みは URL のクエリに持つ（filter.ts）。 */
export function QuickrefPage({ compact = false }: QuickrefPageProps): JSX.Element {
  const load = useQuickrefTable();
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {!compact && (
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">クイック表</h1>
          <p className="text-sm text-muted-foreground">
            症状から処置を引く早見表です。TQ
            などの別の呼び方でも探すときは、上の検索（Ctrl+K）を使ってください。
          </p>
        </div>
      )}
      <QuickrefSyncStatus />
      {load.status === "loading" && <Skeleton className="h-40 w-full" />}
      {load.status === "error" && (
        <IssueCard title="クイック表を読み込めませんでした" detail={load.message} issues={[]} />
      )}
      {load.status === "ready" && <QuickrefBody table={load.table} compact={compact} />}
    </section>
  );
}

function QuickrefBody({ table, compact }: { table: QuickrefTable; compact: boolean }): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const modSettings = useModSettings((s) => s.settings);
  const active = useMemo(() => activeMods(modSettings), [modSettings]);
  const view = useQuickrefSettings((s) => s.settings.view);
  const setView = useQuickrefSettings((s) => s.setView);
  const now = useNow();

  const categories = categoriesOf(table.rows);
  const shown = visibleRows(table.rows, filters, active);
  const target = table.rows.find((r) => r.id === filters.rowId);
  // 行を指して開いたときは、関連リンクまで見えるカードで出す
  const showTable = !compact && view === "table" && target === undefined;

  // 絞り込みを変えたら、指していた行は外す（外さないと絞り込みが効かないため）
  function update(patch: Partial<QuickrefFilters>): void {
    setParams(filtersToParams({ ...filters, rowId: null, ...patch }), { replace: true });
  }

  const targetId = target?.id;
  useEffect(() => {
    if (targetId === undefined) {
      return;
    }
    document.getElementById(rowElementId(targetId))?.scrollIntoView({ block: "start" });
    recordHistory({ kind: "quickref", rowId: targetId });
  }, [targetId]);

  if (table.rows.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>クイック表の行がありません</EmptyTitle>
          <EmptyDescription>起動時の準備が終わると表示されます。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="キーワードで絞り込む"
            placeholder="症状・手順・物品で絞り込む"
            value={filters.keyword}
            onChange={(event) => {
              update({ keyword: event.target.value });
            }}
          />
        </InputGroup>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label="重症度で絞り込む"
          value={filters.severities.map(String)}
          onValueChange={(values) => {
            // ToggleGroup は string[] を返すので、既知の値だけを残して型を戻す
            update({ severities: SEVERITIES.filter((s) => values.includes(String(s))) });
          }}
        >
          {SEVERITIES.map((s) => (
            <ToggleGroupItem key={s} value={String(s)}>
              <span
                aria-hidden
                className={`size-2.5 rounded-full border ${SEVERITY_BADGE_CLASSES[s]}`}
              />
              {severityName(s)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {!compact && (
          <ToggleGroup
            variant="outline"
            size="sm"
            aria-label="表示の形"
            className="sm:ml-auto"
            value={[view]}
            onValueChange={(values) => {
              const next = QUICKREF_VIEWS.find((v) => values.includes(v));
              // 選択中の項目をもう一度押すと空になるので、そのときは今の形のままにする
              if (next !== undefined) {
                setView(next);
              }
            }}
          >
            {QUICKREF_VIEWS.map((v) => (
              <ToggleGroupItem key={v} value={v}>
                {VIEW_LABELS[v]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span>
          {filters.showAll
            ? "すべての組み合わせの行を表示しています"
            : `${modSummary(modSettings)} に合う行を表示しています（設定で変更）`}
        </span>
        <span className="flex items-center gap-2">
          {table.verifiedAt !== null && (
            <Badge variant={isStale(table.verifiedAt, now) ? "destructive" : "outline"}>
              {isStale(table.verifiedAt, now) && <TriangleAlertIcon />}
              確認 {table.verifiedAt}
            </Badge>
          )}
          {/* Base UI の Switch は囲んだ label の文字を名前にする */}
          <label className="flex items-center gap-2 font-medium text-foreground">
            <Switch
              checked={filters.showAll}
              onCheckedChange={(checked) => {
                update({ showAll: checked });
              }}
            />
            すべての組み合わせを表示
          </label>
        </span>
      </div>
      <Tabs
        value={target === undefined ? (filters.category ?? ALL_CATEGORIES) : ALL_CATEGORIES}
        onValueChange={(value: unknown) => {
          const category = categories.find((c) => c === value) ?? null;
          update({ category });
        }}
      >
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value={ALL_CATEGORIES}>すべて</TabsTrigger>
          {categories.map((category) => (
            <TabsTrigger key={category} value={category}>
              {category}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>当てはまる行がありません</EmptyTitle>
            <EmptyDescription>
              絞り込みを外すか、「すべての組み合わせを表示」を試してください。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : showTable ? (
        <QuickrefTableView rows={shown} />
      ) : (
        <ul className={compact ? "flex flex-col gap-3" : "grid gap-4 lg:grid-cols-2"}>
          {shown.map(({ row, hiddenByMods }) => (
            <li key={row.id}>
              <QuickrefCard
                row={row}
                highlighted={row.id === targetId}
                hiddenByMods={hiddenByMods}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 起動時の同期で問題があったときだけ出す（トリアージの一覧と同じ考え方）。 */
function QuickrefSyncStatus(): JSX.Element | null {
  const state = useQuickrefSync((s) => s.state);
  if (state.status === "error") {
    return (
      <IssueCard title="クイック表を準備できませんでした" detail={state.message} issues={[]} />
    );
  }
  if (state.status === "done" && state.result.failed.length > 0) {
    return (
      <IssueCard
        title="クイック表を更新できませんでした"
        detail="前に入れた内容のまま表示しています。"
        issues={state.result.failed}
      />
    );
  }
  return null;
}
