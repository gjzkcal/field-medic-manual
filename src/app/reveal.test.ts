import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { revealMainWindow, waitForFirstScreen } from "@/app/reveal";

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  mockIPC((cmd) => {
    calls.push(cmd);
    return null;
  });
  // jsdom には document.fonts がない
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: () => Promise.resolve([]) },
  });
});

afterEach(() => {
  clearMocks();
});

describe("revealMainWindow", () => {
  it("待っていなければ（小窓やテスト）メインを出さない", async () => {
    await revealMainWindow();
    expect(calls).toEqual([]);
  });

  it("待っていれば 1 回だけメインを出す", async () => {
    waitForFirstScreen();
    await revealMainWindow();
    await revealMainWindow();
    expect(calls).toEqual(["main_window_ready"]);
  });

  it("渡したものが済むまで出さない", async () => {
    let finish = (): void => undefined;
    waitForFirstScreen(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const revealed = revealMainWindow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual([]);
    finish();
    await revealed;
    expect(calls).toEqual(["main_window_ready"]);
  });

  it("フォントを読めなくても出す", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: () => Promise.reject(new Error("読めない")) },
    });
    waitForFirstScreen();
    await revealMainWindow();
    expect(calls).toEqual(["main_window_ready"]);
  });
});
