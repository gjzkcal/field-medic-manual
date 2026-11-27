import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { QuickrefPage } from "@/features/quickref/QuickrefPage";
import { DEFAULT_MOD_SETTINGS, useModSettings } from "@/features/settings/mod-settings";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { axeViolations } from "@/test/axe";

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
const scrollIntoView = vi.fn<Element["scrollIntoView"]>();

function renderPage(path = "/quickref", compact = false): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [{ path: "/quickref", element: <QuickrefPage compact={compact} /> }],
    {
      initialEntries: [path],
    },
  );
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
    expect(symptoms()).toStrictEqual([
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

  it("分類のボタンとキーワードで絞り、残った行の数を読み上げる", async () => {
    renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    const categories = screen.getByRole("group", { name: "分類" });
    fireEvent.click(within(categories).getByRole("button", { name: "意識" }));
    await waitFor(() => {
      expect(symptoms()).toStrictEqual(["意識不明"]);
    });
    expect(screen.getByRole("status").textContent).toBe("1 行");
    fireEvent.click(within(categories).getByRole("button", { name: "すべて" }));
    fireEvent.change(screen.getByRole("textbox", { name: "キーワードで絞り込む" }), {
      target: { value: "ncd" },
    });
    await waitFor(() => {
      expect(symptoms()).toStrictEqual(["緊張性気胸"]);
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
    expect(screen.getByText(/今の MOD の設定では表示されない行です/u)).toBeDefined();
    await waitFor(() => {
      expect(history).toStrictEqual([{ target: { kind: "quickref", rowId: "wake-core" } }]);
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("関連リンクのフローは、id ではなく題名で出す", async () => {
    const commands: string[] = [];
    mockIPC((cmd) => {
      commands.push(cmd);
      if (cmd === "quickref_list") {
        return {
          ...TABLE,
          rows: [row("limb", { links: ["flow:massive-bleeding", "flow:unknown-flow"] })],
        };
      }
      if (cmd === "triage_list") {
        return [
          {
            id: "massive-bleeding",
            title: "出血を止める",
            description: null,
            modTargets: [],
            modChannel: null,
            verifiedAt: null,
            version: 1,
            sourceHash: "h",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ];
      }
      return null;
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "フロー: 出血を止める" })).toBeDefined();
    // 一覧に無いフローは、id のまま出す
    expect(screen.getByRole("button", { name: "フロー: unknown-flow" })).toBeDefined();
    expect(commands.filter((cmd) => cmd === "triage_list")).toHaveLength(1);
  });

  it("フローへのリンクが無い表では、フローの一覧を読まない", async () => {
    const commands: string[] = [];
    mockIPC((cmd) => {
      commands.push(cmd);
      return cmd === "quickref_list" ? TABLE : null;
    });
    renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    expect(commands).not.toContain("triage_list");
  });

  it("カードと表の表示で、axe の違反がない（WCAG 2.2 A・AA）", async () => {
    renderPage();
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    expect(await axeViolations()).toStrictEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "表" }));
    await screen.findByRole("table", { name: "症状ごとの処置" });
    expect(await axeViolations()).toStrictEqual([]);
  });

  it("小窓では、キーワードの欄と「絞り込み」だけを出し、残りは押すまで畳む", async () => {
    renderPage("/quickref", true);
    await waitFor(() => {
      expect(cards()).toHaveLength(4);
    });
    expect(screen.getByRole("textbox", { name: "キーワードで絞り込む" })).toBeDefined();
    expect(screen.queryByRole("group", { name: "重症度で絞り込む" })).toBeNull();
    expect(screen.queryByRole("group", { name: "分類" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "すべての組み合わせを表示" })).toBeNull();
    expect(await axeViolations()).toStrictEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "絞り込み" }));
    const severity = await screen.findByRole("group", { name: "重症度で絞り込む" });
    fireEvent.click(within(severity).getByRole("button", { name: "致命的" }));
    await waitFor(() => {
      expect(symptoms()).toStrictEqual(["手足から大量に出血している", "緊張性気胸"]);
    });
    fireEvent.click(screen.getByRole("switch", { name: "すべての組み合わせを表示" }));
    expect(await axeViolations()).toStrictEqual([]);

    // 畳んでも、使っている絞り込みの数がボタンに残る
    fireEvent.click(screen.getByRole("button", { name: "絞り込み2件を使用中" }));
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "分類" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "絞り込み2件を使用中" })).toBeDefined();
  });

  it("行を指して開いたときは、そのときも効く「すべての組み合わせを表示」だけを数える", async () => {
    // 重症度は、行を指している間は外れるので数えない
    renderPage("/quickref?row=wake-core&sev=1&all=1", true);
    await waitFor(() => {
      expect(cards()).toHaveLength(5);
    });
    expect(screen.getByRole("button", { name: "絞り込み1件を使用中" })).toBeDefined();
  });

  it("小窓でも、確認日が古いという警告は畳まずに出す", async () => {
    mockIPC((cmd) => (cmd === "quickref_list" ? { ...TABLE, verifiedAt: "2000-01-01" } : null));
    renderPage("/quickref", true);
    expect(await screen.findByText("確認 2000-01-01")).toBeDefined();
    expect(screen.queryByRole("group", { name: "分類" })).toBeNull();
  });
});
