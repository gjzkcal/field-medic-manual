import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import type { JSX } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ViewerSettingsPopover } from "@/features/library/viewer/ViewerSettingsPopover";
import { FavoriteButton } from "@/features/prefs/FavoriteButton";

interface MetaBarProps {
  docId: string;
  title: string;
  /** リンクを開けなかったときなどの知らせ */
  notice: string | null;
  onDismissNotice: () => void;
}

/**
 * 本文の上に固定する帯。本文の幅を削らないよう、戻る・タイトル・お気に入り・表示の設定だけにする。
 * モジュールやタグはタイトルの下（DocTitleMeta）、版と確認日は末尾（DocFooter）に置く。
 */
export function MetaBar({ docId, title, notice, onDismissNotice }: MetaBarProps): JSX.Element {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
      <div className="flex items-center gap-3">
        <BackButton />
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
        <FavoriteButton target={{ kind: "document", documentId: docId }} label="このマニュアル" />
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

/**
 * アプリ内に前の画面があれば、そこへ戻る（フローの関連リンクや小窓の検索から開いたとき、元の画面に戻れるように）。
 * 最初に開いた画面（location.key が "default"）ではライブラリへ移る。
 */
function BackButton(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  if (location.key === "default") {
    return (
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/library" />}>
        <ArrowLeftIcon />
        ライブラリ
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigate(-1);
      }}
    >
      <ArrowLeftIcon />
      戻る
    </Button>
  );
}
