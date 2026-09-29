import type { JSX } from "react";

import { IssueCard } from "@/components/IssueCard";
import type { SyncStore } from "@/features/sync/store";

interface SyncStatusCardProps {
  store: SyncStore;
  /** 同期の最中に出す文言。なければ何も出さない */
  syncingText?: string;
  errorTitle: string;
  failedTitle: string;
  failedDetail: string;
  /** 開発ビルドで警告を出すときのタイトル。なければ警告は出さない */
  warningsTitle?: string;
}

/** 起動時の同期で問題があったときだけ出す。うまくいったときは何も出さない（毎回の起動で目障りにならないように）。 */
export function SyncStatusCard({
  store,
  syncingText,
  errorTitle,
  failedTitle,
  failedDetail,
  warningsTitle,
}: SyncStatusCardProps): JSX.Element | null {
  const state = store((s) => s.state);
  if (state.status === "syncing" && syncingText !== undefined) {
    return <p className="text-sm text-muted-foreground">{syncingText}</p>;
  }
  if (state.status === "error") {
    return <IssueCard title={errorTitle} detail={state.message} issues={[]} />;
  }
  if (state.status !== "done") {
    return null;
  }
  const { failed, warnings } = state.result;
  if (failed.length > 0) {
    return <IssueCard title={failedTitle} detail={failedDetail} issues={failed} />;
  }
  // 原稿の書き間違いは作者が直すものなので、開発ビルドでだけ見せる（pnpm test の原稿の検査でも見つかる）
  if (import.meta.env.DEV && warningsTitle !== undefined && warnings.length > 0) {
    return <IssueCard title={warningsTitle} detail="" issues={warnings} />;
  }
  return null;
}
