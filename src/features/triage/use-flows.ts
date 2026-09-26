// トリアージの画面が表示するデータの読み込み。起動時のフローの同期が終わったら読み直す。
import { useEffect, useState } from "react";

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
  const syncStatus = useFlowSync((s) => s.state.status);
  // どの id の結果かを一緒に持つ。id が変わった直後に前のフローを表示しないため
  const [result, setResult] = useState<{ id: string; load: FlowTreeLoad } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadFlowTree(id, triageGet).then(
      (loaded) => {
        if (!cancelled) {
          setResult({ id, load: { status: "ready", ...loaded } });
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        const load: FlowTreeLoad =
          isAppError(error) && error.kind === "not_found"
            ? { status: "not_found" }
            : {
                status: "error",
                message: error instanceof Error ? error.message : errorMessage(error),
              };
        setResult({ id, load });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, syncStatus]);
  return result?.id === id ? result.load : { status: "loading" };
}

export type FlowListLoad =
  | { status: "loading" }
  | { status: "ready"; flows: TriageSummary[] }
  | { status: "error"; message: string };

export function useFlowList(): FlowListLoad {
  const syncStatus = useFlowSync((s) => s.state.status);
  const [state, setState] = useState<FlowListLoad>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    triageList().then(
      (flows) => {
        if (!cancelled) {
          setState({ status: "ready", flows });
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
  }, [syncStatus]);
  return state;
}
