import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import type { JSX } from "react";
import { Link } from "react-router";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ViewerSettingsPopover } from "@/features/library/viewer/ViewerSettingsPopover";

interface MetaBarProps {
  title: string;
  /** リンクを開けなかったときなどの知らせ */
  notice: string | null;
  onDismissNotice: () => void;
}

/**
 * 本文の上に固定する帯。本文の幅を削らないよう、戻る・タイトル・表示の設定だけにする。
 * モジュールやタグはタイトルの下（DocTitleMeta）、版と確認日は末尾（DocFooter）に置く。
 */
export function MetaBar({ title, notice, onDismissNotice }: MetaBarProps): JSX.Element {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/library" />}>
          <ArrowLeftIcon />
          ライブラリ
        </Button>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
        <ViewerSettingsPopover />
      </div>
      {notice !== null && (
        <Alert>
          <InfoIcon />
          <AlertDescription className="text-foreground">{notice}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="xs" onClick={onDismissNotice}>
              閉じる
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}
