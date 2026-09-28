// アプリの更新（GitHub Releases の latest.json）の確認と、ダウンロード・インストールの状態。
// 起動時の確認（main.tsx）と、設定画面の About の「更新を確認」が同じ状態を使う。
import { create } from "zustand";

import {
  checkForUpdate,
  type DownloadProgress,
  errorMessage,
  type PendingUpdate,
  relaunchApp,
} from "@/lib/tauri";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "error"; message: string }
  | { kind: "available"; update: PendingUpdate; installError: string | null }
  | { kind: "installing"; update: PendingUpdate; progress: DownloadProgress | null };

interface UpdateState {
  status: UpdateStatus;
  dialogOpen: boolean;
}

export const useUpdateStore = create<UpdateState>()(() => ({
  status: { kind: "idle" },
  dialogOpen: false,
}));

// プラグインのエラーは文字列で届くが、Error で届いたときに「Error: 」を付けて出さないため
function reason(error: unknown): string {
  return error instanceof Error ? error.message : errorMessage(error);
}

/**
 * 新しい版を確かめる。見つかればダイアログを開く。
 * 起動時の確認（manual: false）は、最新のときも失敗したとき（オフラインなど）も画面に何も出さない。
 */
export async function checkForUpdates({ manual }: { manual: boolean }): Promise<void> {
  const current = useUpdateStore.getState().status.kind;
  // 確認中・インストール中に重ねて確かめない。見つけた更新のリソースを取り違えないため
  if (current === "checking" || current === "installing") {
    return;
  }
  useUpdateStore.setState({ status: { kind: "checking" } });
  try {
    const update = await checkForUpdate();
    if (update === null) {
      useUpdateStore.setState({ status: manual ? { kind: "upToDate" } : { kind: "idle" } });
      return;
    }
    useUpdateStore.setState({
      status: { kind: "available", update, installError: null },
      dialogOpen: true,
    });
  } catch (error: unknown) {
    useUpdateStore.setState({
      status: manual ? { kind: "error", message: reason(error) } : { kind: "idle" },
    });
  }
}

/** 「後で」。ダイアログは閉じるが、更新があることは覚えておき、About から開き直せるようにする */
export function postponeUpdate(): void {
  useUpdateStore.setState({ dialogOpen: false });
}

export function openUpdateDialog(): void {
  if (useUpdateStore.getState().status.kind === "available") {
    useUpdateStore.setState({ dialogOpen: true });
  }
}

/** 「今すぐ更新」。Windows ではインストーラの起動と同時にアプリが終了し、更新後に起動し直す */
export async function installUpdate(): Promise<void> {
  const { status } = useUpdateStore.getState();
  if (status.kind !== "available") {
    return;
  }
  const { update } = status;
  useUpdateStore.setState({ status: { kind: "installing", update, progress: null } });
  try {
    await update.install((progress) => {
      useUpdateStore.setState({ status: { kind: "installing", update, progress } });
    });
    await relaunchApp();
  } catch (error: unknown) {
    useUpdateStore.setState({
      status: { kind: "available", update, installError: reason(error) },
    });
  }
}
