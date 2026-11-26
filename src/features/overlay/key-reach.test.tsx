import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useOverlayKeysReach } from "@/features/overlay/key-reach";

beforeEach(() => {
  mockWindows("overlay");
  mockIPC(() => undefined, { shouldMockEvents: true });
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("useOverlayKeysReach", () => {
  it("隠れて始まる小窓に合わせて false から始まり、Rust の知らせで変わる", async () => {
    const { result } = renderHook(() => useOverlayKeysReach());
    expect(result.current).toBe(false);

    // 購読は非同期に始まるので、届くまで知らせを繰り返す
    await waitFor(async () => {
      await act(async () => {
        await emit("overlay-keys", true);
      });
      expect(result.current).toBe(true);
    });

    await act(async () => {
      await emit("overlay-keys", false);
    });
    expect(result.current).toBe(false);
  });
});
