import { TriangleAlertIcon } from "lucide-react";
import type { JSX } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { MOD_TARGET_LABELS } from "@/features/content/meta";
import { DocTags } from "@/features/library/DocTags";
import { daysSinceVerified, isStale } from "@/features/library/stale";
import type { DocMeta } from "@/lib/bindings/DocMeta";

interface DocTitleMetaProps {
  meta: DocMeta;
  now: Date;
}

/**
 * タイトルの直下に出す、何についての文書か（モジュールとタグ）と、古い内容の警告。
 * 警告は読み始める前に目に入るようここに置く。版と確認日の詳細は末尾の DocFooter に置き、上部を軽くする。
 */
export function DocTitleMeta({ meta, now }: DocTitleMetaProps): JSX.Element {
  const { verifiedAt } = meta;
  const days = verifiedAt === null ? null : daysSinceVerified(verifiedAt, now);
  return (
    <div className="mb-6 flex flex-col gap-3 text-sm leading-normal">
      <div className="flex flex-wrap items-center gap-1.5">
        {meta.modTarget !== null && (
          <Badge variant="secondary">{MOD_TARGET_LABELS[meta.modTarget]}</Badge>
        )}
        <DocTags tags={meta.tags} />
      </div>
      {isStale(verifiedAt, now) && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>古い内容の可能性があります</AlertTitle>
          <AlertDescription>
            {days === null
              ? "確認日が書かれていません。"
              : `${String(days)} 日前（${verifiedAt ?? ""}）に確認した内容です。`}
            ACE Medical の更新で、ゲームの仕様と違っていることがあります。
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
