import { TriangleAlertIcon } from "lucide-react";
import type { JSX } from "react";
import { Link } from "react-router";

import { IssueCard } from "@/components/IssueCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { MOD_CHANNEL_LABELS, MOD_TARGET_LABELS } from "@/features/content/meta";
import { isStale } from "@/features/library/stale";
import { useFlowSync } from "@/features/triage/sync";
import { useFlowList } from "@/features/triage/use-flows";
import { useNow } from "@/hooks/use-now";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";

export function TriageListPage(): JSX.Element {
  const state = useFlowList();
  const now = useNow();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">トリアージ</h1>
        <p className="text-sm text-muted-foreground">
          質問に答えていくと、やることにたどり着きます。数字キーで選び、Backspace で戻り、Esc
          で最初からやり直せます。
        </p>
      </div>
      <FlowSyncStatus />
      {state.status === "loading" && <Skeleton className="h-32 w-full" />}
      {state.status === "error" && (
        <IssueCard title="一覧を読み込めませんでした" detail={state.message} issues={[]} />
      )}
      {state.status === "ready" &&
        (state.flows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>フローがありません</EmptyTitle>
              <EmptyDescription>起動時の準備が終わると表示されます。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {state.flows.map((flow) => (
              <li key={flow.id}>
                <FlowCard flow={flow} now={now} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function FlowCard({ flow, now }: { flow: TriageSummary; now: Date }): JSX.Element {
  const stale = isStale(flow.verifiedAt, now);
  return (
    <Link to={`/triage/${encodeURIComponent(flow.id)}`} className="block h-full rounded-xl">
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{flow.title}</CardTitle>
          {flow.description !== null && <CardDescription>{flow.description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-1.5">
          {flow.modTargets.map((target) => (
            <Badge key={target} variant="secondary">
              {MOD_TARGET_LABELS[target]}
            </Badge>
          ))}
          <Badge variant="outline">
            {flow.modChannel === null ? "版を問わない" : MOD_CHANNEL_LABELS[flow.modChannel]}
          </Badge>
          <Badge variant={stale ? "destructive" : "outline"}>
            {stale && <TriangleAlertIcon />}
            {flow.verifiedAt === null ? "確認日なし" : `確認 ${flow.verifiedAt}`}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}

/** 起動時の同期で問題があったときだけ出す（ライブラリ画面と同じ考え方）。 */
function FlowSyncStatus(): JSX.Element | null {
  const state = useFlowSync((s) => s.state);
  if (state.status === "error") {
    return <IssueCard title="フローを準備できませんでした" detail={state.message} issues={[]} />;
  }
  if (state.status !== "done") {
    return null;
  }
  const { failed, warnings } = state.result;
  if (failed.length > 0) {
    return (
      <IssueCard
        title="一部のフローを更新できませんでした"
        detail="該当するフローは入れていません（前に入れたものがあれば、その内容のままです）。"
        issues={failed}
      />
    );
  }
  // フローの書き間違いは作者が直すものなので、開発ビルドでだけ見せる（pnpm test の原稿の検査でも見つかる）
  if (import.meta.env.DEV && warnings.length > 0) {
    return <IssueCard title="フローの警告（開発ビルドのみ）" detail="" issues={warnings} />;
  }
  return null;
}
