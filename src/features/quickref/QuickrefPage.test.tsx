import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { QuickrefPage } from "@/features/quickref/QuickrefPage";
import { DEFAULT_MOD_SETTINGS, useModSettings } from "@/features/settings/mod-settings";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";

function row(id: string, extra: Partial<QuickrefRow>): QuickrefRow {
  return {
    id,
    category: "出血",
    symptom: id,
    severity: 4,
    treatment: ["包帯を巻く"],
    items: [],
    notes: null,
    links: [],
    mods: [],
    withoutMods: [],
    ...extra,
  };
}

const TABLE: QuickrefTable = {
  sourceHash: "h",
  modChannel: "dev",
  verifiedAt: "2099-01-01",
  rows: [
    row("limb", { symptom: "手足から大量に出血している", items: ["包帯"] }),
    row("ptx", {
      category: "気道・呼吸",
      symptom: "緊張性気胸",
      treatment: ["NCD キットで脱気する", "回復体位にする"],
      items: ["NCD キット"],
      mods: ["breathing"],
    }),
    row("wake-ci", {
      category: "意識",
      symptom: "意識不明",
      severity: 3,
      treatment: ["炭酸アンモニウムを嗅がせる"],
      mods: ["circulation"],
    }),
    row("wake-core", {
      category: "意識",
      symptom: "意識不明",
      severity: 3,
      treatment: ["エピネフリンを注射する"],
      withoutMods: ["circulation"],
    }),
    row("pain", { category: "薬・物品", symptom: "激しい痛み", severity: 1 }),
  ],
};

let history: unknown[] = [];
const scrollIntoView = vi.fn();

function renderPage(path = "/quickref"): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([{ path: "/quickref", element: <QuickrefPage /> }], {
    initialEntries: [path],
  });
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

function cards(): HTMLElement[] {
  return screen.queryAllByRole("article");
}

function symptoms(): string[] {
  return cards().map((card) => within(card).getByRole("heading").textContent);
}

beforeEach(() => {
  history = [];
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  mockIPC((cmd, args) => {
    if (cmd === "quickref_list") {
      return TABLE;
    }
    if (cmd === "history_push") {
      history.push(args);
    }
    return null;
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
  useModSettings.setState({ settings: DEFAULT_MOD_SETTINGS, storageError: null });
});

describe("QuickrefPage", () => {
  it("使っている MOD に合う行を、手順を番号付きで出す", async () => {
    renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    expect(symptoms()).toEqual([
      "手足から大量に出血している",
      "緊張性気胸",
      "意識不明",
      "激しい痛み",
    ]);
    const ptx = cards()[1];
    expect(ptx).toBeDefined();
    if (ptx === undefined) {
      return;
    }
    const steps = within(ptx).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toContain("NCD キットで脱気する");
    expect(within(ptx).getByRole("list", { name: "使う物品" }).textContent).toContain("NCD キット");
  });

  it("重症度「致命的」で絞ると、赤のカードだけが出る", async () => {
    const router = renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    fireEvent.click(screen.getByRole("button", { name: "致命的" }));
    await waitFor(() => {
      expect(cards()).toHaveLength(2);
    });
    for (const card of cards()) {
      expect(card.dataset["severity"]).toBe("4");
      expect(within(card).getByText("致命的")).toBeDefined();
    }
    expect(router.state.location.search).toBe("?sev=4");
  });

  it("カテゴリのタブとキーワードで絞る", async () => {
    renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    fireEvent.click(screen.getByRole("tab", { name: "意識" }));
    await waitFor(() => {
      expect(symptoms()).toEqual(["意識不明"]);
    });
    fireEvent.click(screen.getByRole("tab", { name: "すべて" }));
    fireEvent.change(screen.getByRole("textbox", { name: "キーワードで絞り込む" }), {
      target: { value: "ncd" },
    });
    await waitFor(() => {
      expect(symptoms()).toEqual(["緊張性気胸"]);
    });
  });

  it("「すべての組み合わせを表示」で、使っていない MOD の行も条件付きで出る", async () => {
    renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    expect(screen.queryByText("エピネフリンを注射する")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "すべての組み合わせを表示" }));
    await waitFor(() => {
      expect(cards()).toHaveLength(5);
    });
    expect(screen.getByText("エピネフリンを注射する")).toBeDefined();
    expect(screen.getByText("Circulation なし")).toBeDefined();
  });

  it("行を指して開くと、絞り込みを外してその行を出し、履歴に入れる（MOD で隠れる行でも出す）", async () => {
    renderPage("/quickref?row=wake-core&sev=1");
    await waitFor(() => {
      expect(screen.getByText("エピネフリンを注射する")).toBeDefined();
    });
    expect(cards()).toHaveLength(5);
    expect(screen.getByText(/今の MOD の設定では表示されない行です/)).toBeDefined();
    await waitFor(() => {
      expect(history).toEqual([{ target: { kind: "quickref", rowId: "wake-core" } }]);
    });
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
