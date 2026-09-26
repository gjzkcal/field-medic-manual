import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { todayJst } from "@/features/library/stale";
import type { FlowLookup } from "@/features/triage/runner";
import type { Flow } from "@/features/triage/schema";
import { FlowRunner } from "@/features/triage/view/FlowRunner";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import { end, makeFlow, subflow } from "@/test/flows";

const CHILD = makeFlow("child", "cq", {
  cq: {
    type: "question",
    text: "気道がふさがっている？",
    choices: [
      { label: "はい", tone: "danger", next: "ce" },
      { label: "いいえ", tone: "no", next: "ce" },
    ],
  },
  ce: end("気道を確かめた"),
});

const ROOT: Flow = makeFlow(
  "root",
  "q-safe",
  {
    "q-safe": {
      type: "question",
      text: "周囲は安全？",
      choices: [
        { label: "はい", tone: "yes", next: "a-bleed" },
        { label: "いいえ", tone: "no", next: "q-safe" },
      ],
    },
    "a-bleed": {
      type: "action",
      text: "止血帯で止血する",
      items: ["止血帯"],
      links: ["doc:hemorrhage.md#止血帯を使う"],
      timerSec: 90,
      ifMissing: { next: "a-no-tq" },
      next: "sf",
    },
    "a-no-tq": { type: "action", text: "止血帯なしで対処する", next: "sf" },
    sf: subflow("child", "e-stable"),
    "e-stable": end("安定。定期的に再評価する"),
  },
  { verifiedAt: "2026-09-25" },
);

const LOOKUP: FlowLookup = (id) => (id === "child" ? CHILD : id === "root" ? ROOT : undefined);

const OUTLINE: DocOutline[] = [
  {
    id: "d1",
    title: "止血",
    sourcePath: "bundle://manuals/hemorrhage.md",
    meta: { modTarget: "core", modChannel: null, modVersion: null, verifiedAt: null, tags: [] },
    headings: [{ level: 2, title: "止血帯を使う", anchor: "止血帯を使う" }],
  },
];

function renderRunner(
  initialPath = "/triage/root",
  root = ROOT,
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      { path: "/triage/:id", element: <FlowRunner root={root} lookup={LOOKUP} /> },
      { path: "/doc/:id", element: <p>ビューア</p> },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function heading(): string {
  return screen.getByRole("heading", { level: 2 }).textContent;
}

function press(key: string): void {
  fireEvent.keyDown(window, { key });
}

beforeEach(() => {
  mockIPC((cmd) => (cmd === "doc_outline" ? OUTLINE : null));
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("FlowRunner", () => {
  it("キーボードだけで、サブフローを通って end まで進める", () => {
    const router = renderRunner();
    expect(heading()).toBe("周囲は安全？");

    press("1");
    expect(heading()).toBe("止血帯で止血する");
    expect(router.state.location.search).toBe("?path=0");

    press("Enter");
    expect(heading()).toBe("気道がふさがっている？");
    expect(screen.getByText("child のタイトル")).toBeDefined();

    press("2");
    expect(heading()).toBe("気道を確かめた");
    expect(screen.getByRole("button", { name: /元のフローへ戻る/ })).toBeDefined();

    press("1");
    expect(heading()).toBe("安定。定期的に再評価する");
    expect(screen.getByText("安定")).toBeDefined();
    expect(router.state.location.search).toBe("?path=0.0.1.0");
  });

  it("物品を使う処置では 2 で「持っていない」の行き先へ進み、Enter は「次へ」のまま", () => {
    const router = renderRunner("/triage/root?path=0");
    expect(screen.getByRole("button", { name: /止血帯を持っていない/ })).toBeDefined();

    press("2");
    expect(heading()).toBe("止血帯なしで対処する");
    expect(router.state.location.search).toBe("?path=0.1");

    press("Backspace");
    press("Enter");
    expect(heading()).toBe("気道がふさがっている？");
  });

  it("Backspace で戻り、Esc で最初から、パンくずで途中へ戻る", () => {
    renderRunner("/triage/root?path=0.0.1");
    expect(heading()).toBe("気道を確かめた");

    press("Backspace");
    expect(heading()).toBe("気道がふさがっている？");

    fireEvent.click(screen.getByRole("button", { name: /周囲は安全？/ }));
    expect(heading()).toBe("周囲は安全？");

    press("1");
    press("Escape");
    expect(heading()).toBe("周囲は安全？");
  });

  it("選択肢の数より大きい数字や、入力欄の中のキーは無視する", () => {
    render(<input aria-label="検索" />);
    renderRunner();
    press("3");
    expect(heading()).toBe("周囲は安全？");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "検索" }), { key: "1" });
    expect(heading()).toBe("周囲は安全？");
  });

  it("長い経路は古い歩を畳み、押すと全部出す", () => {
    // 「いいえ」で同じ質問に 5 回戻ってから進む
    renderRunner("/triage/root?path=1.1.1.1.1.0");
    expect(screen.queryAllByRole("button", { name: /周囲は安全？/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "…ほか 3 歩" }));
    expect(screen.queryAllByRole("button", { name: /周囲は安全？/ })).toHaveLength(6);
  });

  it("URL の経路から続きを表示し、無効な部分は捨てる", () => {
    renderRunner("/triage/root?path=0.9.9");
    expect(heading()).toBe("止血帯で止血する");
  });

  it("action は物品・タイマー・関連リンクを出し、リンクからビューアの節へ移る", async () => {
    const router = renderRunner("/triage/root?path=0");
    expect(screen.getByText("止血帯", { selector: "[data-slot=badge]" })).toBeDefined();
    expect(screen.getByRole("timer").textContent).toBe("1:30");

    const link = await screen.findByRole("button", { name: "止血 › 止血帯を使う" });
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/doc/d1");
    });
    expect(router.state.location.hash).toBe(`#${encodeURIComponent("止血帯を使う")}`);
  });

  it("確認日が古いか書かれていなければ警告する", () => {
    renderRunner("/triage/root", { ...ROOT, verifiedAt: "2020-01-01" });
    expect(screen.getByText("内容が古い可能性があります")).toBeDefined();
    cleanup();
    // 確認日のないサブフローに入ったときも出す
    renderRunner("/triage/root?path=0.0", { ...ROOT, verifiedAt: todayJst(new Date()) });
    expect(screen.getByText("内容が古い可能性があります")).toBeDefined();
    cleanup();
    renderRunner("/triage/root", { ...ROOT, verifiedAt: todayJst(new Date()) });
    expect(screen.queryByText("内容が古い可能性があります")).toBeNull();
  });
});
