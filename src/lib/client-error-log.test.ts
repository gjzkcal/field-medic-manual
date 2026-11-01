import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logClientError, startClientErrorLog } from "@/lib/client-error-log";

function recordLogs(): string[] {
  const logged: string[] = [];
  mockIPC((cmd, payload) => {
    if (cmd === "client_log" && payload !== undefined && "message" in payload) {
      logged.push(String(payload["message"]));
    }
    return null;
  });
  return logged;
}

afterEach(() => {
  clearMocks();
});

describe("logClientError", () => {
  it("Error はスタックごと送る", async () => {
    const logged = recordLogs();
    const error = new Error("壊れた");
    error.stack = "Error: 壊れた\n    at f (a.js:1:2)";

    logClientError("処理", error);

    await vi.waitFor(() => {
      expect(logged).toEqual(["処理: Error: 壊れた\n    at f (a.js:1:2)"]);
    });
  });

  it("コマンドの失敗は文面を送る", async () => {
    const logged = recordLogs();

    logClientError("処理", { kind: "internal", message: "内部" });

    await vi.waitFor(() => {
      expect(logged).toEqual(["処理: 内部"]);
    });
  });

  it("ログのコマンドが失敗しても例外にしない", async () => {
    const seen = vi.fn();
    mockIPC(() => {
      seen();
      throw new Error("書けない");
    });

    expect(() => {
      logClientError("処理", "x");
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(seen).toHaveBeenCalled();
    });
  });
});

describe("startClientErrorLog", () => {
  it("拾われなかった例外と失敗を送る", async () => {
    const logged = recordLogs();
    startClientErrorLog();

    window.dispatchEvent(new ErrorEvent("error", { message: "描画の例外" }));
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "拒否の理由" }));

    await vi.waitFor(() => {
      expect(logged).toEqual(["例外: 描画の例外", "処理されなかった失敗: 拒否の理由"]);
    });
  });
});
