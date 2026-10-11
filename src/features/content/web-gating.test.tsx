import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RelatedLinks } from "@/features/content/RelatedLinks";
import { FavoriteButton } from "@/features/prefs/FavoriteButton";

// Web 版のビルドと同じ状態にする（トリアージとお気に入りがない）
vi.mock("@/lib/platform", () => ({ IS_WEB: true }));

afterEach(() => {
  cleanup();
  clearMocks();
});

function renderInRouter(element: React.ReactNode): void {
  const router = createMemoryRouter([{ path: "/", element }]);
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
}

describe("Web 版での出し分け", () => {
  it("関連ページからフローへのリンクを除き、ほかのリンクは残す", async () => {
    mockIPC(() => []);
    renderInRouter(<RelatedLinks links={["flow:casualty-first-contact", "https://example.com/"]} />);

    expect(await screen.findByRole("button", { name: "https://example.com/" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /フロー:/ })).toBeNull();
  });

  it("フローへのリンクしかなければ、関連ページの欄ごと出さない", () => {
    mockIPC(() => []);
    renderInRouter(<RelatedLinks links={["flow:casualty-first-contact"]} />);

    expect(screen.queryByText("関連ページ")).toBeNull();
  });

  it("お気に入りのボタンを出さない", () => {
    mockIPC(() => []);
    renderInRouter(<FavoriteButton target={{ kind: "document", documentId: "d1" }} label="このマニュアル" />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
