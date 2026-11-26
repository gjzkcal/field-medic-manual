// トリアージの画面が表示するデータの読み込み。起動時のフローの同期が終わったら読み直す。
import { useSyncedLoad } from "@/features/sync/use-synced-load";
import type { LoadedFlows } from "@/features/triage/load";
import { useFlowSync } from "@/features/triage/sync";
import type { TriageDetail } from "@/lib/bindings/TriageDetail";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";
import { errorMessage, isAppError, triageGet, triageList } from "@/lib/tauri";

export type FlowTreeLoad =
  | { status: "loading" }
  | ({ status: "ready" } & LoadedFlows)
  | { status: "not_found" }
  | { status: "error"; message: string };

async function loadTree(id: string): Promise<LoadedFlows> {
  // フローの形の検査（zod）は、実行画面を開いたときに読み込む（どの画面も読む最初の JS に入れないため）。
  // 検査のコードを待ってからフローを取りに行くと通信が 1 往復ぶん遅くなるので、ルートのフローは同時に取り始める
  const root = triageGet(id);
  // 失敗は loadFlowTree が同じ Promise から受け取る。それまでの間、受け手のいない失敗として報告されないようにする
  root.catch(() => undefined);
  const { loadFlowTree } = await import("@/features/triage/load");
  return loadFlowTree(id, (flowId): Promise<TriageDetail> =>
    flowId === id ? root : triageGet(flowId),
  );
}

export function useFlowTree(id: string): FlowTreeLoad {
  const load = useSyncedLoad(useFlowSync, id, () => loadTree(id));
  switch (load.status) {
    case "loading":
      return load;
    case "ready":
      return { status: "ready", ...load.value };
    case "error":
      return isAppError(load.error) && load.error.kind === "not_found"
        ? { status: "not_found" }
        : { status: "error", message: errorMessage(load.error) };
  }
}

export type FlowListLoad =
  | { status: "loading" }
  | { status: "ready"; flows: TriageSummary[] }
  | { status: "error"; message: string };

/** enabled が false のときは読まない（フローへのリンクがない画面で IPC を呼ばないため） */
export function useFlowList(enabled = true): FlowListLoad {
  const load = useSyncedLoad(useFlowSync, enabled ? "list" : null, triageList);
  switch (load.status) {
    case "loading":
      return load;
    case "ready":
      return { status: "ready", flows: load.value };
    case "error":
      return { status: "error", message: errorMessage(load.error) };
  }
}
