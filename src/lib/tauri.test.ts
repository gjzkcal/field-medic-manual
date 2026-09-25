import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { appVersion, isAppError } from "@/lib/tauri";

afterEach(() => {
  clearMocks();
});

describe("appVersion", () => {
  it("app_version コマンドの戻り値を返す", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd === "app_version" ? "0.1.0" : undefined;
    });

    await expect(appVersion()).resolves.toBe("0.1.0");
    expect(calls).toEqual(["app_version"]);
  });
});

describe("isAppError", () => {
  it("Rust の AppError の形を受け入れる", () => {
    expect(isAppError({ kind: "not_found", message: "見つかりません: doc 42" })).toBe(true);
  });

  it("未知の kind や形の違う値を拒否する", () => {
    expect(isAppError({ kind: "unknown", message: "x" })).toBe(false);
    expect(isAppError({ kind: "io" })).toBe(false);
    expect(isAppError("io")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
