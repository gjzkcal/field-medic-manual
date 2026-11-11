// AI が提案した、負傷者の記録への操作の承認のカード（AI Elements の Confirmation の手本に合わせ、
// 承認を待つ間は Item に承認・却下のボタンを置き、答えた後は調べた様子と同じ 1 行にする）。
import { CircleCheckIcon, ClipboardListIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, type JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { loadCasualties, useCasualties } from "@/features/casualties/casualty-store";
import type { AnswerItem } from "@/features/chat/chat-turn";
import { describeOps } from "@/features/chat/proposal-view";

type ProposalItem = Extract<AnswerItem, { kind: "propose" }>;

interface ProposalCardProps {
  item: ProposalItem;
  /** 回答が終わった（止めた）後は、もう承認を届けられない */
  disabled: boolean;
  onDecide: (toolUseId: string, approve: boolean) => void;
}

export function ProposalCard({ item, disabled, onDecide }: ProposalCardProps): JSX.Element {
  const casualties = useCasualties((s) => s.casualties);
  const loaded = useCasualties((s) => s.loaded);
  useEffect(() => {
    // 負傷者の画面を開いていないと一覧を読んでいないので、名前で示すために読む
    void loadCasualties();
  }, []);

  if (item.status !== "pending") {
    return <DecidedLine item={item} />;
  }
  const ops = describeOps(item.ops, casualties);
  const missing = loaded && ops.some((o) => o.missing);
  // 消すだけの提案には、時刻の断りは要らない
  const adds = item.ops.some(
    (op) => !["remove_casualty", "clear_all", "remove_record"].includes(op.action),
  );
  return (
    <Item variant="outline" size="sm" role="group" aria-label="記録の提案">
      <ItemMedia variant="icon">
        <ClipboardListIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{item.summary}</ItemTitle>
        <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-sm">
          {ops.map((op, index) => (
            <li
              // 提案の中身は届いた後に変わらない
              // oxlint-disable-next-line react/no-array-index-key -- 上の理由
              key={index}
              className={op.destructive || op.missing ? "text-destructive" : undefined}
            >
              {op.text}
            </li>
          ))}
        </ul>
        <ItemDescription>
          {missing
            ? "見つからない負傷者か記録が含まれているので、承認できません。AI に言い直してください"
            : disabled
              ? "回答が止まったので、承認できません"
              : adds
                ? "記録の時刻は、承認した時刻になります"
                : "消した記録は元に戻せません"}
        </ItemDescription>
      </ItemContent>
      <ItemFooter className="justify-end">
        <ItemActions>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              onDecide(item.toolUseId, false);
            }}
          >
            却下
          </Button>
          <Button
            size="sm"
            disabled={disabled || !loaded || missing}
            onClick={() => {
              onDecide(item.toolUseId, true);
            }}
          >
            承認して記録する
          </Button>
        </ItemActions>
      </ItemFooter>
    </Item>
  );
}

function DecidedLine({ item }: { item: ProposalItem }): JSX.Element {
  const { icon, title, status } = ((): {
    icon: JSX.Element;
    title: string;
    status?: "running" | "error";
  } => {
    switch (item.status) {
      case "pending":
      case "applying":
        return { icon: <Spinner />, title: `記録しています: ${item.summary}`, status: "running" };
      case "approved":
        return { icon: <CircleCheckIcon />, title: `記録しました: ${item.summary}` };
      case "rejected":
        return {
          icon: <CircleXIcon />,
          title: `却下しました（記録していません）: ${item.summary}`,
        };
      case "failed":
        return {
          icon: <TriangleAlertIcon />,
          title: `記録の途中で失敗しました: ${item.summary}（${item.error ?? ""}）`,
          status: "error",
        };
    }
  })();
  return (
    <Trace>
      <TraceLine {...(status === undefined ? {} : { status })}>
        <TraceIcon>{icon}</TraceIcon>
        <TraceTitle>{title}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}
