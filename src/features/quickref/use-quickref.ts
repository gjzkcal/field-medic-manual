// クイック表の画面・関連リンクが表示するデータの読み込み。起動時の同期が終わったら読み直す。
import { useEffect, useState } from "react";

import { useQuickrefSync } from "@/features/quickref/sync";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { errorMessage, quickrefList } from "@/lib/tauri";

export type QuickrefLoad =
  | { status: "loading" }
  | { status: "ready"; table: QuickrefTable }
  | { status: "error"; message: string };

/** enabled が false のときは読まない（関連リンクにクイック表がないときに IPC を呼ばないため） */
export function useQuickrefTable(enabled = true): QuickrefLoad {
  const syncStatus = useQuickrefSync((s) => s.state.status);
  const [state, setState] = useState<QuickrefLoad>({ status: "loading" });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    quickrefList().then(
      (table) => {
        if (!cancelled) {
          setState({ status: "ready", table });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: errorMessage(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, syncStatus]);
  return state;
}
