import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RelatedLinks } from "@/features/content/RelatedLinks";
import { FavoriteButton } from "@/features/prefs/FavoriteButton";
import { TriageRunPage } from "@/features/triage/TriageRunPage";

// Web 版のビルドと同じ状態にする（お気に入りがなく、フローの同期をしない）
vi.mock(import('@/lib/platform'), () => ({ IS_WEB: true }));

afterEach(() => {
  cleanup();
  clearMocks();
});

function renderInRouter(element: React.ReactNode, path = "/", initialEntry = "/"): void {
  const router = createMemoryRouter([{ path, element }], { initialEntries: [initialEntry] });
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
}

describe("Web 版での出し分け", () => {
  it("関連ページにフローへのリンクも出す", async () => {
    mockIPC(() => []);
    renderInRouter(<RelatedLinks links={["flow:casualty-first-contact", "https://example.com/"]} />);

    expect(await screen.findByRole("button", { name: "https://example.com/" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /フロー:/u })).toBeTruthy();
  });

  it("ないフローを開くと、同期を待たずに「見つかりません」を出す", async () => {
    mockIPC((cmd) => {
      if (cmd === "triage_get") {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Tauri はコマンドのエラーを Error ではなく AppError の素のオブジェクトで reject する。それを再現する
        return Promise.reject({ kind: "not_found", message: "フロー no-such-flow" });
      }
      return [];
    });
    renderInRouter(<TriageRunPage />, "/triage/:id", "/triage/no-such-flow");

    expect(await screen.findByText("フローが見つかりません")).toBeTruthy();
  });

  it("お気に入りのボタンを出さない", () => {
    mockIPC(() => []);
    renderInRouter(<FavoriteButton target={{ kind: "document", documentId: "d1" }} label="このマニュアル" />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
