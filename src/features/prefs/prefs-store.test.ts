import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refreshPrefs, toggleFavorite, usePrefs } from "@/features/prefs/prefs-store";
import type { PrefItem } from "@/lib/bindings/PrefItem";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";

const FLOW: PrefTarget = { kind: "flow", flowId: "first-contact" };

function item(target: PrefTarget, title: string): PrefItem {
  return { target, title, context: null, at: "2026-09-26T00:00:00.000Z" };
}

let favorites: PrefItem[] = [];
let calls: string[] = [];

beforeEach(() => {
  favorites = [];
  calls = [];
  usePrefs.setState({ favorites: [], history: [], error: null });
  mockIPC((cmd, args) => {
    calls.push(cmd);
    switch (cmd) {
      case "fav_toggle": {
        const on = favorites.length === 0;
        favorites = on ? [item(FLOW, "負傷者への最初の対応")] : [];
        return on;
      }
      case "fav_list":
        return favorites;
      case "history_list":
        return args !== undefined && "limit" in args ? [item(FLOW, "負傷者への最初の対応")] : [];
      default:
        return undefined;
    }
  });
});

afterEach(() => {
  clearMocks();
});

describe("prefs-store", () => {
  it("読み込むとお気に入りと最近見たものが入る", async () => {
    await refreshPrefs();
    const state = usePrefs.getState();
    expect(state.favorites).toEqual([]);
    expect(state.history.map((h) => h.title)).toEqual(["負傷者への最初の対応"]);
    expect(state.error).toBeNull();
  });

  it("お気に入りを切り替えると一覧を読み直す", async () => {
    await expect(toggleFavorite(FLOW)).resolves.toBe(true);
    expect(usePrefs.getState().favorites.map((f) => f.target)).toEqual([FLOW]);
    await expect(toggleFavorite(FLOW)).resolves.toBe(false);
    expect(usePrefs.getState().favorites).toEqual([]);
    expect(calls.filter((c) => c === "fav_toggle")).toHaveLength(2);
  });

  it("読めなければエラーを持ち、前の一覧を消さない", async () => {
    usePrefs.setState({ favorites: [item(FLOW, "前の一覧")] });
    mockIPC(() => {
      throw new Error("DB が壊れている");
    });
    await refreshPrefs();
    expect(usePrefs.getState().favorites.map((f) => f.title)).toEqual(["前の一覧"]);
    expect(usePrefs.getState().error).toContain("DB が壊れている");
  });
});
