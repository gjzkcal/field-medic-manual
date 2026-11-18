import type { JSX } from "react";
import { Link } from "react-router";

import { LinkButton } from "@/components/LinkButton";
import { Badge } from "@/components/ui/badge";
import type { AnswerItem } from "@/features/chat/chat-turn";
import { docHref } from "@/features/library/link";
import { ManualLineChart } from "@/features/library/viewer/ManualLineChart";

interface AiChartProps {
  item: Extract<AnswerItem, { kind: "chart" }>;
}

/**
 * AI が条件を指定し、アプリが計算したグラフ。
 * 原稿の図と違って作者が確かめたものではないので、何を条件にした線かを必ず一緒に出す
 * （AI が条件を取り違えても、利用者が気づけるように）。
 */
export function AiChart({ item }: AiChartProps): JSX.Element | null {
  if (item.chart === null) {
    return null;
  }
  const { spec, data, conditions, sources } = item.chart;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <figure className="m-0 text-sm">
        <ManualLineChart spec={spec} data={data} withTable={false} />
      </figure>
      <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-xs text-muted-foreground">
        {conditions.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
      {sources.length > 0 && (
        // 原稿の線は、その節に書いてある条件のもの。条件を確かめられるよう、節を開けるようにする
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {sources.map((source) => (
            <LinkButton
              key={`${source.docId}#${source.anchor}`}
              variant="link"
              size="xs"
              className="h-auto p-0"
              render={<Link to={docHref(source.docId, source.anchor)} />}
            >
              {source.title} を開く
            </LinkButton>
          ))}
        </div>
      )}
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="secondary">AI が条件を指定</Badge>
        AI が指定した条件から、アプリが描いたグラフです。条件が合っているか確かめてください
      </p>
    </div>
  );
}
