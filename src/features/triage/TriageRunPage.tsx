import { ArrowLeftIcon } from "lucide-react";
import type { JSX } from "react";
import { Link, useParams } from "react-router";

import { IssueCard } from "@/components/IssueCard";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlowSync } from "@/features/triage/sync";
import { useFlowTree } from "@/features/triage/use-flows";
import { FlowRunner } from "@/features/triage/view/FlowRunner";

export function TriageRunPage(): JSX.Element {
  const { id = "" } = useParams();
  const load = useFlowTree(id);
  const syncing = useFlowSync((s) => s.state.status === "syncing" || s.state.status === "idle");

  switch (load.status) {
    case "loading":
      return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
    case "ready":
      return <FlowRunner root={load.root} lookup={load.lookup} />;
    case "not_found":
      // 起動直後は同期の途中で、まだ DB に入っていないことがある
      return syncing ? (
        <Skeleton className="mx-auto h-64 w-full max-w-2xl" />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>フローが見つかりません</EmptyTitle>
            <EmptyDescription>「{id}」というフローはありません。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <BackToList />
          </EmptyContent>
        </Empty>
      );
    case "error":
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <IssueCard title="フローを開けませんでした" detail={load.message} issues={[]} />
          <BackToList />
        </div>
      );
  }
}

function BackToList(): JSX.Element {
  return (
    <Button variant="outline" nativeButton={false} render={<Link to="/triage" />} className="w-fit">
      <ArrowLeftIcon />
      フローの一覧へ
    </Button>
  );
}
