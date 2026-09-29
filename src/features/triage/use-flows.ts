// トリアージの画面が表示するデータの読み込み。起動時のフローの同期が終わったら読み直す。
import { useSyncedLoad } from "@/features/sync/use-synced-load";
import { loadFlowTree, type LoadedFlows } from "@/features/triage/load";
import { useFlowSync } from "@/features/triage/sync";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";
import { errorMessage, isAppError, triageGet, triageList } from "@/lib/tauri";

export type FlowTreeLoad =
  | { status: "loading" }
  | ({ status: "ready" } & LoadedFlows)
  | { status: "not_found" }
  | { status: "error"; message: string };

export function useFlowTree(id: string): FlowTreeLoad {
  const load = useSyncedLoad(useFlowSync, id, () => loadFlowTree(id, triageGet));
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

export function useFlowList(): FlowListLoad {
  const load = useSyncedLoad(useFlowSync, "list", triageList);
  switch (load.status) {
    case "loading":
      return load;
    case "ready":
      return { status: "ready", flows: load.value };
    case "error":
      return { status: "error", message: errorMessage(load.error) };
  }
}
