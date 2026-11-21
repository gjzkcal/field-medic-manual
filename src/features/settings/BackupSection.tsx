import { DownloadIcon, HistoryIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useContentSync } from "@/features/content/sync";
import { SettingsSection } from "@/features/settings/SettingsSection";
import { formatReleaseDate } from "@/features/updater/release-date";
import type { BackupEntry } from "@/lib/bindings/BackupEntry";
import type { BackupKind } from "@/lib/bindings/BackupKind";
import type { BackupPreview } from "@/lib/bindings/BackupPreview";
import {
  backupExport,
  backupList,
  backupOpenAuto,
  backupOpenFile,
  backupRestore,
  errorMessage,
} from "@/lib/tauri";

const KIND_LABEL: Record<BackupKind, string> = {
  auto: "自動",
  before_restore: "復元の前",
  manual: "書き出し",
};

type Notice = { kind: "status" | "alert"; text: string } | null;

/** 一覧を読み直す間隔。設定を開いたままでも、アプリが取った新しいバックアップが出るようにする */
const LIST_REFRESH_MS = 30_000;

function when(iso: string): string {
  return formatReleaseDate(iso) ?? iso;
}

/** お気に入り・履歴・設定のバックアップと復元。 */
export function BackupSection(): JSX.Element {
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restarting, setRestarting] = useState(false);
  // 原稿を DB に入れ終わる前に復元すると、お気に入りと履歴の行き先（原稿）が見つからず、戻せない。
  // 同期が失敗したときも、原稿がそろっているかは分からないので、成功するまで復元させない
  const syncStatus = useContentSync((s) => s.state.status);
  const notReady = syncStatus !== "done";

  const fail = useCallback((what: string, cause: unknown) => {
    setNotice({ kind: "alert", text: `${what}: ${errorMessage(cause)}` });
  }, []);

  const reload = useCallback(() => {
    backupList().then(setEntries, (cause: unknown) => {
      fail("バックアップの一覧を読めませんでした", cause);
    });
  }, [fail]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      // 定期の読み直しの失敗は知らせない（操作の結果の知らせを、30 秒ごとに上書きしないため）
      backupList().then(setEntries, () => undefined);
    }, LIST_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [reload]);

  /** 保存先やファイルを選ぶダイアログが出ている間は、ほかの操作を受けない。 */
  async function run(what: string, task: () => Promise<void>): Promise<void> {
    setNotice(null);
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      fail(what, cause);
    } finally {
      setBusy(false);
    }
  }

  function handleExport(): void {
    void run("バックアップを書き出せませんでした", async () => {
      const result = await backupExport();
      if (result === null) {
        return;
      }
      const skipped =
        result.skipped > 0
          ? `。マニュアルから無くなった項目など ${String(result.skipped)} 件は入れていません`
          : "";
      setNotice({
        kind: "status",
        text: `${result.fileName} に書き出しました（お気に入り ${String(result.favorites)} 件・履歴 ${String(result.history)} 件）${skipped}`,
      });
    });
  }

  function handleOpen(open: () => Promise<BackupPreview | null>): void {
    void run("バックアップを読めませんでした", async () => {
      setPreview(await open());
    });
  }

  function handleRestore(token: string): void {
    setNotice(null);
    setRestarting(true);
    // 成功すると、応答が届く前にアプリが再起動することがある。先に「再起動しています」を出しておく
    backupRestore(token).catch((cause: unknown) => {
      setRestarting(false);
      setPreview(null);
      fail("復元できませんでした", cause);
      reload();
    });
  }

  return (
    <SettingsSection title="バックアップ">
      <p className="text-sm text-muted-foreground">
        お気に入り・履歴・設定・ホットキーを 1 つのファイルに保存します。アプリは 1 日 1
        回、自動で保存場所にバックアップを取り、直近 7 回分を残します。負傷者の記録と AI の API
        キーは入りません。
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" disabled={busy} onClick={handleExport}>
          <DownloadIcon />
          ファイルに書き出す
        </Button>
        <Button
          variant="outline"
          disabled={busy || notReady}
          onClick={() => {
            handleOpen(backupOpenFile);
          }}
        >
          <UploadIcon />
          ファイルから復元
        </Button>
      </div>
      {notReady && (
        <p className="text-xs text-muted-foreground">
          {syncStatus === "error"
            ? "マニュアルの準備に失敗したので、復元はできません。アプリを起動し直してください。"
            : "マニュアルの準備が終わるまで、復元はできません。"}
        </p>
      )}
      {notice !== null && (
        <p
          role={notice.kind}
          className={notice.kind === "alert" ? "text-sm text-destructive" : "text-sm"}
        >
          {notice.text}
        </p>
      )}
      <BackupList
        entries={entries}
        disabled={busy || notReady}
        onPick={(id) => {
          handleOpen(() => backupOpenAuto(id));
        }}
      />
      <RestoreDialog
        preview={preview}
        restarting={restarting}
        blocked={notReady}
        onCancel={() => {
          setPreview(null);
        }}
        onConfirm={handleRestore}
      />
    </SettingsSection>
  );
}

function BackupList({
  entries,
  disabled,
  onPick,
}: {
  entries: BackupEntry[];
  disabled: boolean;
  onPick: (id: string) => void;
}): JSX.Element {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        自動のバックアップは、まだありません。起動してしばらくすると、最初の 1 つを取ります。
      </p>
    );
  }
  return (
    <ul aria-label="アプリが取ったバックアップ" className="flex flex-col divide-y pt-1">
      {entries.map((entry) => {
        const label = `${KIND_LABEL[entry.kind]} ${when(entry.createdAt)}`;
        return (
          <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-sm">
              <span className="text-muted-foreground">{KIND_LABEL[entry.kind]}</span>{" "}
              <span className="tabular-nums">{when(entry.createdAt)}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`この時点に戻す: ${label}`}
              onClick={() => {
                onPick(entry.id);
              }}
            >
              <HistoryIcon />
              この時点に戻す
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** 置き換えは戻しにくいので、何が入り何が入らないかを見せてから行う。 */
function RestoreDialog({
  preview,
  restarting,
  blocked,
  onCancel,
  onConfirm,
}: {
  preview: BackupPreview | null;
  restarting: boolean;
  /** 確認を開いている間に、マニュアルの準備が済んでいない状態になった */
  blocked: boolean;
  onCancel: () => void;
  onConfirm: (token: string) => void;
}): JSX.Element {
  const unresolved = (preview?.unresolvedFavorites ?? 0) + (preview?.unresolvedHistory ?? 0);
  return (
    <Dialog
      open={preview !== null}
      onOpenChange={(open) => {
        // 再起動を待っている間は閉じさせない（閉じると、古い設定の画面を触れてしまう）
        if (!open && !restarting) {
          onCancel();
        }
      }}
    >
      <DialogContent showCloseButton={!restarting}>
        <DialogHeader>
          <DialogTitle>バックアップから復元</DialogTitle>
          <DialogDescription>
            今のお気に入り・履歴・設定・ホットキーを、このバックアップの内容で置き換えます。今の状態は「復元の前」として自動でバックアップしてから置き換え、アプリを再起動します。
          </DialogDescription>
        </DialogHeader>
        {preview !== null && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">作った日時</dt>
            <dd className="tabular-nums">
              {when(preview.createdAt)}（{KIND_LABEL[preview.kind]}、v{preview.appVersion}）
            </dd>
            <dt className="text-muted-foreground">戻すもの</dt>
            <dd>
              お気に入り {preview.favorites} 件・履歴 {preview.history} 件・設定{" "}
              {preview.settings.length} 項目
            </dd>
            {unresolved > 0 && (
              <>
                <dt className="text-muted-foreground">戻せないもの</dt>
                <dd>
                  今のマニュアルに見つからないお気に入り {preview.unresolvedFavorites} 件・履歴{" "}
                  {preview.unresolvedHistory} 件
                </dd>
              </>
            )}
            {preview.skippedSettings.length > 0 && (
              <>
                <dt className="text-muted-foreground">戻さない設定</dt>
                <dd>
                  この版のアプリに無い設定 {preview.skippedSettings.length}{" "}
                  項目（新しい版で作ったバックアップです）
                </dd>
              </>
            )}
          </dl>
        )}
        {restarting && (
          <p role="status" className="text-sm">
            復元しています。終わると、アプリが再起動します…
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={restarting} />}>
            キャンセル
          </DialogClose>
          <Button
            variant="destructive"
            disabled={restarting || blocked || preview === null}
            onClick={() => {
              if (preview !== null) {
                onConfirm(preview.token);
              }
            }}
          >
            置き換えて再起動
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
