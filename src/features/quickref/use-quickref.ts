// クイック表の画面・関連リンクが表示するデータの読み込み。起動時の同期が終わったら読み直す。
import { useQuickrefSync } from "@/features/quickref/sync";
import { useSyncedLoad } from "@/features/sync/use-synced-load";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { errorMessage, quickrefList } from "@/lib/tauri";

export type QuickrefLoad =
  | { status: "loading" }
  | { status: "ready"; table: QuickrefTable }
  | { status: "error"; message: string };

/** enabled が false のときは読まない（関連リンクにクイック表がないときに IPC を呼ばないため） */
export function useQuickrefTable(enabled = true): QuickrefLoad {
  const load = useSyncedLoad(useQuickrefSync, enabled ? "quickref" : null, quickrefList);
  switch (load.status) {
    case "loading":
      return load;
    case "ready":
      return { status: "ready", table: load.value };
    case "error":
      return { status: "error", message: errorMessage(load.error) };
  }
}
