import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppVersion } from "@/app/AppVersion";

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("AppVersion", () => {
  it("取得したバージョンを表示する", async () => {
    mockIPC((cmd) => (cmd === "app_version" ? "0.1.0" : undefined));

    render(<AppVersion />);

    expect(await screen.findByText("v0.1.0")).toBeDefined();
  });

  it("AppError を受け取ったら取得失敗を表示する", async () => {
    mockIPC((cmd) => {
      if (cmd === "app_version") {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Tauri はコマンドのエラーを Error ではなく AppError の素のオブジェクトで reject する。それを再現する
        return Promise.reject({ kind: "internal", message: "内部エラー: test" });
      }
      return undefined;
    });

    render(<AppVersion />);

    const message = await screen.findByText("バージョンを取得できませんでした");
    expect(message.getAttribute("title")).toBe("内部エラー: test");
  });
});
