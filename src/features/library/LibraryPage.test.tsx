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
      tags: [],
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
});
