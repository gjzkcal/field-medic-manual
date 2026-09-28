import { CircleAlertIcon } from "lucide-react";
import type { JSX } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { DownloadProgress } from "@/lib/tauri";

import { formatReleaseDate } from "./release-date";
import { installUpdate, postponeUpdate, useUpdateStore } from "./update-store";

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

/** 起動時の確認か、About の「更新を確認」で新しい版が見つかったときに出す（メインのウィンドウだけ） */
export function UpdateDialog(): JSX.Element | null {
  const status = useUpdateStore((s) => s.status);
  const open = useUpdateStore((s) => s.dialogOpen);

  if (status.kind !== "available" && status.kind !== "installing") {
    return null;
  }
  const { info } = status.update;
  const installing = status.kind === "installing";
  const released = formatReleaseDate(info.date);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // インストール中に閉じると、進み具合が見えないままアプリが終了するので閉じさせない
        if (!next && !installing) {
          postponeUpdate();
        }
      }}
    >
      <DialogContent showCloseButton={!installing}>
        <DialogHeader>
          <DialogTitle>新しい版があります</DialogTitle>
          <DialogDescription>
            v{info.currentVersion} → v{info.version}
            {released !== null && `（公開: ${released}）`}
          </DialogDescription>
        </DialogHeader>
        {info.notes !== "" && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">変更点</h3>
            {/* 変更点は CHANGELOG の Markdown。HTML にせずテキストのまま出す（無害化が要らない） */}
            <p className="max-h-64 overflow-y-auto rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
              {info.notes}
            </p>
          </div>
        )}
        {status.kind === "installing" && <InstallProgress progress={status.progress} />}
        {status.kind === "available" && status.installError !== null && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>更新できませんでした</AlertTitle>
            <AlertDescription>{status.installError}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={installing} onClick={postponeUpdate}>
            後で
          </Button>
          <Button
            disabled={installing}
            onClick={() => {
              void installUpdate();
            }}
          >
            今すぐ更新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstallProgress({ progress }: { progress: DownloadProgress | null }): JSX.Element {
  const total = progress?.total ?? null;
  const downloaded = progress?.downloaded ?? 0;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {/* 大きさが分からないときは null で「進行中」の表示にする */}
      <Progress
        aria-label="ダウンロードの進み具合"
        value={total === null || total === 0 ? null : Math.min(100, (downloaded / total) * 100)}
      />
      <p className="text-muted-foreground tabular-nums">
        {total === null
          ? `${megabytes(downloaded)} MB`
          : `${megabytes(downloaded)} / ${megabytes(total)} MB`}
      </p>
      <p className="text-muted-foreground">
        ダウンロードが終わるとインストーラが起動し、アプリは一度終了します。更新が終わると起動し直します。
      </p>
    </div>
  );
}
