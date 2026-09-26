import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/features/search/CommandPalette";
import { EMPTY_SEARCH_FILTER, useSearchFilter } from "@/features/search/search-filter";
import { MARK_END, MARK_START } from "@/features/search/snippet";
import type { SearchHit } from "@/lib/bindings/SearchHit";

function hit(id: number, title: string, matchedTerms: string[], synonymOnly = false): SearchHit {
  return {
    kind: "section",
    id,
    title,
    snippet: `…四肢の${MARK_START}${matchedTerms[0] ?? ""}${MARK_END}について…`,
    score: 1,
    documentId: `d${String(id)}`,
    documentTitle: "止血",
    anchor: title,
    synonymOnly,
    matchedTerms,
  };
}

const HITS = [hit(1, "止血帯を使う", ["止血帯"]), hit(2, "包帯を巻く", ["止血"])];

let queries: { q: unknown; filter: unknown }[] = [];

beforeEach(() => {
  queries = [];
  useSearchFilter.setState({ filter: EMPTY_SEARCH_FILTER, changed: false, storageError: null });
  // jsdom にない API の代わり（cmdk が一覧の高さの監視と、選んだ項目までのスクロールに使う）
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // 位置の計算は jsdom ではできないので、呼べることだけを確かめる
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        // 何もしない
      }
      unobserve(): void {
        // 何もしない
      }
      disconnect(): void {
        // 何もしない
      }
    },
  );
  mockIPC((cmd, args) => {
    if (cmd === "search_query" && args !== undefined && "q" in args && "filter" in args) {
      queries.push({ q: args["q"], filter: args["filter"] });
      return args["q"] === "なし" ? [] : HITS;
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.unstubAllGlobals();
});

function input(): HTMLElement {
  return screen.getByRole("combobox");
}

describe("CommandPalette", () => {
  it("入力が空のときは案内（または渡した中身）を出し、検索しない", () => {
    const { rerender } = render(<CommandPalette onSelect={vi.fn()} />);
    expect(screen.getByText(/語を入力すると/u)).toBeTruthy();
    rerender(<CommandPalette onSelect={vi.fn()} emptySlot={<p>最近見たもの</p>} />);
    expect(screen.getByText("最近見たもの")).toBeTruthy();
    expect(queries).toEqual([]);
  });

  it("続けて打った入力は待ってから 1 回だけ検索し、結果とスニペットの強調を出す", async () => {
    render(<CommandPalette onSelect={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "止" } });
    fireEvent.change(input(), { target: { value: "止血" } });
    fireEvent.change(input(), { target: { value: "止血帯 " } });
    await screen.findByText("止血帯を使う");
    expect(queries).toEqual([{ q: "止血帯", filter: {} }]);
    expect(screen.getAllByText("止血帯", { selector: "mark" })).toHaveLength(1);
  });

  it("↓ と Enter で選んだ結果の開く先を渡す（検索語はハイライト用に載せる）", async () => {
    const onSelect = vi.fn();
    render(<CommandPalette onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: "止血" } });
    await screen.findByText("包帯を巻く");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      `/doc/d2?hl=${encodeURIComponent("止血")}#${encodeURIComponent("包帯を巻く")}`,
      HITS[1],
    );
  });

  it("変換中の Enter と Ctrl+Enter では開かない。Ctrl+Enter はお気に入りに渡す", async () => {
    const onSelect = vi.fn();
    const onFavorite = vi.fn();
    render(<CommandPalette onSelect={onSelect} onFavorite={onFavorite} />);
    fireEvent.change(input(), { target: { value: "止血" } });
    await screen.findByText("止血帯を使う");
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onFavorite).toHaveBeenCalledWith(HITS[0]);
  });

  it("該当がなければそう伝える", async () => {
    render(<CommandPalette onSelect={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "なし" } });
    await screen.findByText("「なし」に一致する項目はありません");
  });

  it("保存した絞り込みで検索し、絞り込み中の数を出す", async () => {
    useSearchFilter.setState({
      filter: { modTargets: ["core"], modChannel: "release", tags: [] },
    });
    render(<CommandPalette onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "絞り込み（2 件）" })).toBeTruthy();
    fireEvent.change(input(), { target: { value: "CPR" } });
    await waitFor(() => {
      expect(queries).toEqual([
        { q: "CPR", filter: { modTargets: ["core"], modChannel: "release" } },
      ]);
    });
  });
});

describe("CommandPalette（上部の検索欄）", () => {
  function list(): Element | null {
    return document.querySelector("[cmdk-list]");
  }

  it("フォーカスするまで一覧を出さず、Esc で閉じる", () => {
    render(<CommandPalette variant="dropdown" onSelect={vi.fn()} />);
    expect(list()).toBeNull();
    fireEvent.focus(input());
    expect(list()).not.toBeNull();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(list()).toBeNull();
  });

  it("外を押すと閉じ、絞り込みのポップオーバーの中を押しても閉じない", () => {
    render(
      <>
        <CommandPalette variant="dropdown" onSelect={vi.fn()} />
        <div data-slot="popover-content">
          <button type="button">Dev</button>
        </div>
        <p>本文</p>
      </>,
    );
    fireEvent.focus(input());
    fireEvent.pointerDown(screen.getByText("Dev"));
    expect(list()).not.toBeNull();
    fireEvent.pointerDown(screen.getByText("本文"));
    expect(list()).toBeNull();
  });

  it("選ぶと開く先を渡し、入力欄を空にして一覧を閉じる", async () => {
    const onSelect = vi.fn();
    render(<CommandPalette variant="dropdown" onSelect={onSelect} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "止血" } });
    await screen.findByText("止血帯を使う");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(input()).toHaveProperty("value", "");
    expect(list()).toBeNull();
  });
});
