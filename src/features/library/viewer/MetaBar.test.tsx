import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Link, RouterProvider } from "react-router";

import { MetaBar } from "@/features/library/viewer/MetaBar";
import { usePrefs } from "@/features/prefs/prefs-store";

function renderAt(): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      { path: "/library", element: <p>ライブラリの画面</p> },
      { path: "/search", element: <Link to="/doc/d1">節を開く</Link> },
      {
        path: "/doc/:id",
        element: <MetaBar docId="d1" title="止血" notice={null} onDismissNotice={vi.fn()} />,
      },
    ],
    { initialEntries: ["/doc/d1"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

let toggled: unknown[] = [];

beforeEach(() => {
  toggled = [];
  usePrefs.setState({ favorites: [], history: [], error: null });
  mockIPC((cmd, args) => {
    if (cmd === "fav_toggle" && args !== undefined && "target" in args) {
      toggled.push(args["target"]);
      return true;
    }
    return cmd === "fav_list" || cmd === "history_list" ? [] : undefined;
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("MetaBar", () => {
  it("最初に開いた画面ではライブラリへのボタンを出す", () => {
    renderAt();
    expect(screen.getByRole("button", { name: /ライブラリ/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /戻る/u })).toBeNull();
  });

  it("アプリ内で前の画面があれば「戻る」で戻る", async () => {
    const router = renderAt();
    await router.navigate("/search");
    fireEvent.click(await screen.findByText("節を開く"));
    fireEvent.click(await screen.findByRole("button", { name: /戻る/u }));
    await screen.findByText("節を開く");
    expect(router.state.location.pathname).toBe("/search");
  });

  it("星のボタンで文書をお気に入りに入れる", async () => {
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: /お気に入りに入れる/u }));
    await vi.waitFor(() => {
      expect(toggled).toEqual([{ kind: "document", documentId: "d1" }]);
    });
  });
});
