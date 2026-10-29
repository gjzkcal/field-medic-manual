import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, type JSX } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { usePageTitle } from "@/app/use-page-title";
import { useRouteFocus } from "@/app/use-route-focus";

function Shell(): JSX.Element {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  return (
    <>
      <nav>
        <Link to="/b">B へ</Link>
        <Link to="/a?x=1">A のクエリ</Link>
      </nav>
      <main ref={mainRef}>
        <Outlet />
      </main>
    </>
  );
}

function PageA(): JSX.Element {
  usePageTitle("画面 A");
  return <h1>画面 A</h1>;
}

function PageB(): JSX.Element {
  usePageTitle("画面 B");
  return (
    <>
      <h1>画面 B</h1>
      <p>本文</p>
    </>
  );
}

/** トリアージの質問のように、画面が自分でフォーカスを置くもの */
function SelfFocusPage(): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <>
      <h1>自分で置く</h1>
      <button ref={ref} type="button">
        最初の選択肢
      </button>
    </>
  );
}

function renderAt(path: string): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: "a", element: <PageA /> },
          { path: "b", element: <PageB /> },
          { path: "self", element: <SelfFocusPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
});

describe("画面の表題とフォーカス", () => {
  it("表題は「画面の名前 - アプリの名前」", () => {
    renderAt("/a");
    expect(document.title).toBe("画面 A - Field Medic Manual");
  });

  it("最初の画面ではフォーカスを動かさない", () => {
    renderAt("/a");
    expect(document.activeElement).toBe(document.body);
  });

  it("画面を移ると、移った先の h1 にフォーカスが移り、表題も変わる", () => {
    renderAt("/a");
    const link = screen.getByRole("link", { name: "B へ" });
    link.focus();
    fireEvent.click(link);
    const heading = screen.getByRole("heading", { level: 1, name: "画面 B" });
    expect(document.activeElement).toBe(heading);
    // Tab の順には入れない
    expect(heading.tabIndex).toBe(-1);
    expect(document.title).toBe("画面 B - Field Medic Manual");
  });

  it("クエリだけが変わったときは動かさない", () => {
    renderAt("/a");
    const link = screen.getByRole("link", { name: "A のクエリ" });
    link.focus();
    fireEvent.click(link);
    expect(document.activeElement).toBe(link);
  });

  it("移った先の画面が自分でフォーカスを置いたときは、それを残す", async () => {
    const router = renderAt("/a");
    await act(async () => {
      await router.navigate("/self");
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "最初の選択肢" }));
  });
});
