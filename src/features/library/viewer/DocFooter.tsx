import type { JSX } from "react";

import { MOD_CHANNEL_LABELS } from "@/features/content/meta";
import { daysSinceVerified } from "@/features/library/stale";
import type { DocMeta } from "@/lib/bindings/DocMeta";

interface DocFooterProps {
  meta: DocMeta;
  now: Date;
}

/** 本文の末尾に置く、どの版を前提にいつ確認した内容か。文書の奥付に当たるので、読む邪魔にならない最後に置く。 */
export function DocFooter({ meta, now }: DocFooterProps): JSX.Element {
  const channel = meta.modChannel === null ? "版を問わない" : MOD_CHANNEL_LABELS[meta.modChannel];
  const days = meta.verifiedAt === null ? null : daysSinceVerified(meta.verifiedAt, now);
  return (
    <footer className="mt-10 border-t pt-4 text-sm leading-normal text-muted-foreground">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt>対象の版</dt>
        <dd>{meta.modVersion === null ? channel : `${channel} ${meta.modVersion}`}</dd>
        <dt>最終確認日</dt>
        <dd>
          {meta.verifiedAt === null
            ? "記載なし"
            : `${meta.verifiedAt}${days === null ? "" : `（${String(days)} 日前）`}`}
        </dd>
      </dl>
    </footer>
  );
}
