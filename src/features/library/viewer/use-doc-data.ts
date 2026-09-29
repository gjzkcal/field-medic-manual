// ビューアが表示するデータの読み込み。同期（起動時）が終わったら読み直し、原稿の更新を開いている画面にも反映する。
import { useContentSync } from "@/features/content/sync";
import { useSyncedLoad } from "@/features/sync/use-synced-load";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import { docGet, docOutline, errorMessage, isAppError } from "@/lib/tauri";

export type DocLoad =
  | { status: "loading" }
  | { status: "ready"; doc: DocDetail }
  | { status: "not_found" }
  | { status: "error"; message: string };

export function useDoc(id: string): DocLoad {
  const load = useSyncedLoad(useContentSync, id, () => docGet(id));
  switch (load.status) {
    case "loading":
      return load;
    case "ready":
      return { status: "ready", doc: load.value };
    case "error":
      return isAppError(load.error) && load.error.kind === "not_found"
        ? { status: "not_found" }
        : { status: "error", message: errorMessage(load.error) };
  }
}

// 読めないあいだに毎回新しい配列を返さないため（受け取る側のメモ化を崩さない）
const NO_OUTLINE: DocOutline[] = [];

/** 左のツリーと内部リンクの解決に使う。読めなければ空にする（本文の表示は止めない）。 */
export function useOutline(): DocOutline[] {
  const load = useSyncedLoad(useContentSync, "outline", docOutline);
  return load.status === "ready" ? load.value : NO_OUTLINE;
}
