import { cn } from "cn";
import { EyeOffIcon } from "lucide-react";
import { useId, type JSX } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { RelatedLinks } from "@/features/content/RelatedLinks";
import { FavoriteButton } from "@/features/prefs/FavoriteButton";
import { conditionLabel } from "@/features/quickref/conditions";
import { rowElementId } from "@/features/quickref/link";
import {
  SEVERITY_BADGE_CLASSES,
  SEVERITY_BORDER_CLASSES,
  severityName,
  toSeverity,
  type Severity,
} from "@/features/quickref/severity";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";

interface QuickrefCardProps {
  row: QuickrefRow;
  /** 検索・お気に入り・リンクから指された行 */
  highlighted: boolean;
  /** 使っている MOD では出ない行（「すべての組み合わせ」か、行を指して開いたときだけ出る） */
  hiddenByMods: boolean;
}

/**
 * クイック表の 1 行。小窓（幅 420px）でも読めるよう 1 列で組み、症状を大きく、手順を番号付きで出す。
 */
export function QuickrefCard({ row, highlighted, hiddenByMods }: QuickrefCardProps): JSX.Element {
  const headingId = useId();
  const severity = toSeverity(row.severity);
  const condition = conditionLabel(row);
  return (
    <article
      id={rowElementId(row.id)}
      aria-labelledby={headingId}
      data-severity={severity}
      // スクロールで上端に寄せたとき、見出しが上の帯に隠れないように
      className="scroll-mt-4"
    >
      <Card
        className={cn(
          "h-full gap-3 border-l-4",
          SEVERITY_BORDER_CLASSES[severity],
          highlighted && "ring-2 ring-primary",
        )}
      >
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={severity} />
            <Badge variant="outline">{row.category}</Badge>
            {condition !== null && <Badge variant="secondary">{condition}</Badge>}
          </div>
          <h2 id={headingId} className="text-xl leading-snug font-bold">
            {row.symptom}
          </h2>
          <CardAction>
            <FavoriteButton target={{ kind: "quickref", rowId: row.id }} label="この行" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {hiddenByMods && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <EyeOffIcon aria-hidden className="size-4 shrink-0" />
              今の MOD の設定では表示されない行です（{condition}）。
            </p>
          )}
          <ol className="flex list-decimal flex-col gap-1 pl-6 text-base leading-relaxed marker:text-muted-foreground">
            {row.treatment.map((step, i) => (
              // 手順は同じ文が並びうるので、並びの位置も key に含める
              <li key={`${String(i)}:${step}`}>{step}</li>
            ))}
          </ol>
          {row.items.length > 0 && (
            <ul aria-label="使う物品" className="flex flex-wrap gap-1.5">
              {row.items.map((item) => (
                <li key={item}>
                  <Badge variant="secondary" className="h-7 px-3 text-sm">
                    {item}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {row.notes !== null && (
            <p className="text-sm leading-relaxed text-muted-foreground">{row.notes}</p>
          )}
          <RelatedLinks links={row.links} />
        </CardContent>
      </Card>
    </article>
  );
}

/** 色だけで伝えないよう、言葉も出す */
export function SeverityBadge({ severity }: { severity: Severity }): JSX.Element {
  return (
    <Badge variant="outline" className={SEVERITY_BADGE_CLASSES[severity]}>
      {severityName(severity)}
    </Badge>
  );
}
