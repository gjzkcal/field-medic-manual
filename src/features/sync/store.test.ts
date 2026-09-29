import { describe, expect, it } from "vitest";

import { emptySyncResult } from "@/features/sync/result";
import { createBundledSync, type SyncState } from "@/features/sync/store";

describe("createBundledSync", () => {
  it("同期の間は syncing にし、終わったら結果を入れて返す", async () => {
    const result = { ...emptySyncResult(), added: 1 };
    const seen: SyncState[] = [];
    const { useSync, sync } = createBundledSync(() => {
      seen.push(useSync.getState().state);
      return Promise.resolve(result);
    });
    expect(useSync.getState().state).toEqual({ status: "idle" });

    await expect(sync()).resolves.toBe(result);
    expect(seen).toEqual([{ status: "syncing" }]);
    expect(useSync.getState().state).toEqual({ status: "done", result });
  });

  it("同期そのものが失敗したら null を返し、理由を入れる", async () => {
    const { useSync, sync } = createBundledSync(() => Promise.reject(new Error("DB を開けない")));
    await expect(sync()).resolves.toBeNull();
    expect(useSync.getState().state).toEqual({ status: "error", message: "DB を開けない" });
  });
});
