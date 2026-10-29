import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { OverlayLayout } from "@/features/overlay/OverlayLayout";
import { axeViolations } from "@/test/axe";

/** jsdom には matchMedia がない。窓が狭い（タブが絵だけ）かどうかを決めて返す */
function stubNarrow(narrow: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: (): void => {
      // 幅は変わらない
    },
    removeEventListener: (): void => {
      // 幅は変わらない
    },
  }));
}

beforeEach(() => {
  stubNarrow(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("タブが絵だけの幅では、マウスを載せると名前を出す。文字が見える幅では出さない", async () => {
    const hover = (): void => {
      const tab = screen.getByRole("link", { name: "お気に入り" });
      fireEvent.pointerEnter(tab, { pointerType: "mouse" });
      fireEvent.mouseEnter(tab);
      fireEvent.mouseMove(tab);
    };
    const tooltip = (): Element | null => document.querySelector("[data-slot=tooltip-content]");

    stubNarrow(true);
    renderOverlay();
    hover();
    await waitFor(() => {
      expect(tooltip()?.textContent).toBe("お気に入り");
    });

    cleanup();
    stubNarrow(false);
    renderOverlay();
    hover();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tooltip()).toBeNull();
  });

  it("axe の違反がない（WCAG 2.2 A・AA）", async () => {
    renderOverlay();
    expect(await axeViolations()).toEqual([]);
  });
});
