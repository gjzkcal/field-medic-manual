import { TriangleAlertIcon } from "lucide-react";
import type { JSX } from "react";

import { Badge } from "@/components/ui/badge";
import { MOD_CHANNEL_LABELS, MOD_TARGET_LABELS } from "@/features/content/meta";
import { isStale } from "@/features/library/stale";
import type { DocMeta } from "@/lib/bindings/DocMeta";

interface DocMetaBadgesProps {
  meta: DocMeta;
  now: Date;
}

/** 対象モジュール・版・確認日と、古い内容の印。ライブラリの一覧とビューアで同じ見た目にする。 */
export function DocMetaBadges({ meta, now }: DocMetaBadgesProps): JSX.Element {
  const stale = isStale(meta.verifiedAt, now);
  const channel = meta.modChannel === null ? "版を問わない" : MOD_CHANNEL_LABELS[meta.modChannel];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {meta.modTarget !== null && (
        <Badge variant="secondary">{MOD_TARGET_LABELS[meta.modTarget]}</Badge>
      )}
      <Badge variant="outline">
        {meta.modVersion === null ? channel : `${channel} ${meta.modVersion}`}
      </Badge>
      <Badge variant={stale ? "destructive" : "outline"}>
        {stale && <TriangleAlertIcon />}
        {meta.verifiedAt === null ? "確認日なし" : `確認 ${meta.verifiedAt}`}
      </Badge>
    </div>
  );
}
