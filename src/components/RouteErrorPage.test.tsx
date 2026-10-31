import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { router } from "@/app/router";
import { RouteErrorPage } from "@/components/RouteErrorPage";
import { webRouter } from "@/web/router";

const SECRET = "secret_table の読み取りに失敗";

function Broken(): JSX.Element {
  throw new Error(SECRET);
}

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("RouteErrorPage", () => {
  it("内部の文面は画面に出さず、ログにだけ送る", async () => {
    // React と React Router が受け止めた例外を console に出す。テストの出力を汚さないよう止める
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logged: string[] = [];
    mockIPC((cmd, payload) => {
      if (cmd === "client_log" && payload !== undefined && "message" in payload) {
        logged.push(String(payload["message"]));
      }
      return null;
    });
    const memory = createMemoryRouter([
      { path: "/", element: <Broken />, errorElement: <RouteErrorPage /> },
    ]);

    const { container } = render(<RouterProvider router={memory} />);

    expect((await screen.findByRole("alert")).textContent).toContain("画面を表示できませんでした");
    expect(container.textContent).not.toContain(SECRET);
    await waitFor(() => {
      expect(logged.some((message) => message.includes(SECRET))).toBe(true);
    });
  });
});

describe("ルーター", () => {
  // 外側だけだと、枠なしのウィンドウでタイトルバーごと消える
  it.each([
    ["デスクトップ版", router.routes],
    ["Web 版", webRouter.routes],
  ])("%s は Layout の内側と外側の両方に受け皿がある", (_name, routes) => {
    const outer = routes[0];
    expect(outer?.errorElement).toBeDefined();
    expect(outer?.children?.[0]?.errorElement).toBeDefined();
  });
});
