import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { OverlayLayout } from "@/features/overlay/OverlayLayout";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function renderOverlay(): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      {
        element: <OverlayLayout />,
        children: [
          { path: "/quickref", element: <h1>クイック表</h1> },
          { path: "/favorites", element: <h1>お気に入り</h1> },
        ],
      },
    ],
    { initialEntries: ["/quickref"] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

describe("OverlayLayout", () => {
  it("タブは名前の付いたナビゲーションの中のリンクで、今のタブを伝える。中身は main に置く", () => {
    renderOverlay();
    const nav = screen.getByRole("navigation", { name: "小窓の画面" });
    const current = screen.getByRole("link", { name: "クイック表" });
    expect(nav.contains(current)).toBe(true);
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("main").textContent).toContain("クイック表");
  });

  it("タブを移ると、移った先の見出しへフォーカスを移す", async () => {
    const router = renderOverlay();
    await act(async () => {
      await router.navigate("/favorites");
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "お気に入り" }));
  });

  it("axe の違反がない（WCAG 2.2 A・AA）", async () => {
    renderOverlay();
    expect(await axeViolations()).toEqual([]);
  });
});
