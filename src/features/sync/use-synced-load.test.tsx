import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emptySyncResult } from "@/features/sync/result";
import { createBundledSync } from "@/features/sync/store";
import { useSyncedLoad } from "@/features/sync/use-synced-load";

afterEach(() => {
  cleanup();
});

describe("useSyncedLoad", () => {
  it("key が変わったら読み終わるまで loading にし、前の値を出さない", async () => {
    const { useSync } = createBundledSync(() => Promise.resolve(emptySyncResult()));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSyncedLoad(useSync, id, () => Promise.resolve(`doc-${id}`)),
      { initialProps: { id: "a" } },
    );
    await waitFor(() => {
      expect(result.current).toEqual({ status: "ready", value: "doc-a" });
    });

    rerender({ id: "b" });
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current).toEqual({ status: "ready", value: "doc-b" });
    });
  });

  it("同期が終わったら、前の値を出したまま読み直す", async () => {
    const { useSync, sync } = createBundledSync(() => Promise.resolve(emptySyncResult()));
    let version = 1;
    const rendered: unknown[] = [];
    const { result } = renderHook(() => {
      const load = useSyncedLoad(useSync, "list", () => Promise.resolve(version));
      rendered.push(load);
      return load;
    });
    await waitFor(() => {
      expect(result.current).toEqual({ status: "ready", value: 1 });
    });

    version = 2;
    rendered.length = 0;
    await act(async () => {
      await sync();
    });
    await waitFor(() => {
      expect(result.current).toEqual({ status: "ready", value: 2 });
    });
    expect(rendered).not.toContainEqual({ status: "loading" });
  });

  it("読めなければエラーを返し、key が null なら読まない", async () => {
    const { useSync } = createBundledSync(() => Promise.resolve(emptySyncResult()));
    const failing = renderHook(() =>
      useSyncedLoad(useSync, "x", () => Promise.reject(new Error("壊れた"))),
    );
    await waitFor(() => {
      expect(failing.result.current).toEqual({ status: "error", error: new Error("壊れた") });
    });

    const load = vi.fn(() => Promise.resolve(1));
    const disabled = renderHook(() => useSyncedLoad(useSync, null, load));
    await act(async () => {
      await Promise.resolve();
    });
    expect(disabled.result.current).toEqual({ status: "loading" });
    expect(load).not.toHaveBeenCalled();
  });
});
