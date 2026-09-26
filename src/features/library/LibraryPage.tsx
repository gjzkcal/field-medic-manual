import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useContentSync, type SyncIssue } from "@/features/content/sync";

export function LibraryPage(): JSX.Element {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">ライブラリ</h1>
      <SyncStatus />
      {/* 一覧は Step 04 で作る。それまでは設定画面のデバッグ（開発ビルドのみ）で確認する */}
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>準備中</EmptyTitle>
          <EmptyDescription>マニュアルの一覧を表示します（Step 04）。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
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
