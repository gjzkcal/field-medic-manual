import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LibraryPage } from "@/features/library/LibraryPage";
import type { DocSummary } from "@/lib/bindings/DocSummary";

afterEach(() => {
  cleanup();
  clearMocks();
});

function doc(id: string, title: string, meta: Partial<DocSummary["meta"]>): DocSummary {
  return {
    id,
    title,
    sourceType: "markdown",
    sourcePath: `bundle://manuals/${id}.md`,
    sourceHash: "h",
    meta: {
      modTarget: null,
      modChannel: null,
      modVersion: null,
      verifiedAt: "2099-01-01",
      aceCommit: null,
      gameVersion: null,
      tags: [],
      order: null,
      category: null,
      ...meta,
    },
    sectionCount: 2,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
  };
}

describe("LibraryPage", () => {
  it("一覧を出し、モジュールで絞り込み、文書へのリンクを張る", async () => {
    mockIPC((cmd) =>
      cmd === "doc_list"
        ? [
            doc("hemorrhage", "止血", { modTarget: "core", tags: ["出血"] }),
            doc("cardiac", "心停止と CPR", {
              modTarget: "circulation",
              modChannel: "dev",
              modVersion: "1.5.36",
              verifiedAt: null,
            }),
          ]
        : null,
    );
    const router = createMemoryRouter([{ path: "/library", element: <LibraryPage /> }], {
      initialEntries: ["/library"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("止血")).toBeDefined();
    expect(screen.getByText("2 件")).toBeDefined();
    expect(screen.getByText("Dev 1.5.36")).toBeDefined();
    expect(screen.getByText("確認日なし")).toBeDefined();
    expect(screen.getByText("止血").closest("a")?.getAttribute("href")).toBe("/doc/hemorrhage");

    fireEvent.click(screen.getByRole("button", { name: "Circulation" }));

    expect(screen.queryByText("止血")).toBeNull();
    expect(screen.getByText("1 件（全 2 件）")).toBeDefined();
  });

  it("既定では原稿の order の順に並べる", async () => {
    mockIPC((cmd) =>
      cmd === "doc_list"
        ? [
            doc("hemorrhage", "止血", { order: 20 }),
            doc("cardiac", "心停止と CPR", { order: 30 }),
            doc("about", "この原稿の読み方", { order: 10 }),
          ]
        : null,
    );
    const router = createMemoryRouter([{ path: "/library", element: <LibraryPage /> }], {
      initialEntries: ["/library"],
    });
    render(<RouterProvider router={router} />);

    await screen.findByText("止血");
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((href) => href?.startsWith("/doc/") === true);
    expect(hrefs).toEqual(["/doc/about", "/doc/hemorrhage", "/doc/cardiac"]);
    expect(screen.getByRole("button", { name: "標準" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("標準の並び順では分類の見出しで区切り、ほかの並び順では区切らない", async () => {
    mockIPC((cmd) =>
      cmd === "doc_list"
        ? [
            doc("about", "この原稿の読み方", { order: 10, category: "はじめに" }),
            doc("hemorrhage", "止血", { order: 20, category: "症状/処置", modTarget: "core" }),
            doc("cardiac", "心停止と CPR", {
              order: 30,
              category: "症状/処置",
              modTarget: "circulation",
            }),
            doc("extra", "付録", { order: 40 }),
          ]
        : null,
    );
    const router = createMemoryRouter([{ path: "/library", element: <LibraryPage /> }], {
      initialEntries: ["/library"],
    });
    render(<RouterProvider router={router} />);

    await screen.findByText("止血");
    const headings = (): (string | null)[] =>
      screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings()).toEqual(["はじめに", "症状/処置", "その他"]);
    const group = screen.getByRole("region", { name: "症状/処置" });
    expect(group.textContent).toContain("止血");
    expect(group.textContent).toContain("心停止と CPR");

    // 絞り込みで原稿がなくなった分類は見出しごと出さない
    fireEvent.click(screen.getByRole("button", { name: "Circulation" }));
    expect(headings()).toEqual(["症状/処置"]);

    fireEvent.click(screen.getByRole("button", { name: "Circulation" }));
    fireEvent.click(screen.getByRole("button", { name: "タイトル" }));
    expect(headings()).toEqual([]);
    expect(screen.getByText("止血")).toBeDefined();
  });
});
