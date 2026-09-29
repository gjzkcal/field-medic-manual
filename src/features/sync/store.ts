// 起動時の同期の状態。画面はこれを見て、同期の問題を出したり、終わったら DB を読み直したりする。
import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { SyncResult } from "@/features/sync/result";
import { errorMessage } from "@/lib/tauri";

export type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; result: SyncResult }
  | { status: "error"; message: string };

export type SyncStore = UseBoundStore<StoreApi<{ state: SyncState }>>;

export interface BundledSync {
  useSync: SyncStore;
  /** 同期して、結果を useSync に入れる。同期そのものが失敗したら null（理由は useSync に入る） */
  sync: () => Promise<SyncResult | null>;
}

export function createBundledSync(run: () => Promise<SyncResult>): BundledSync {
  const useSync: SyncStore = create<{ state: SyncState }>()(() => ({
    state: { status: "idle" },
  }));
  async function sync(): Promise<SyncResult | null> {
    useSync.setState({ state: { status: "syncing" } });
    try {
      const result = await run();
      useSync.setState({ state: { status: "done", result } });
      return result;
    } catch (error: unknown) {
      useSync.setState({ state: { status: "error", message: errorMessage(error) } });
      return null;
    }
  }
  return { useSync, sync };
}
