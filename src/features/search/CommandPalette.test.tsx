import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX } from "react";

import { CommandPalette } from "@/features/search/CommandPalette";
import { usePaletteOpen } from "@/features/search/palette-open";
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

/** 空のときの中身の代わり。パレットから受け取った open で開く */
function RecentFlowButton(): JSX.Element {
  const open = usePaletteOpen();
  return (
    <button
      type="button"
      onClick={() => {
        open("/triage/first-contact");
      }}
    >
      最近見たフロー
    </button>
  );
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
    );
  });

  it("お気に入りに入っている結果には星を付ける", async () => {
    render(<CommandPalette onSelect={vi.fn()} isFavorite={(hit) => hit.id === 2} />);
    fireEvent.change(input(), { target: { value: "止血" } });
    await screen.findByText("包帯を巻く");
    expect(screen.getAllByRole("img", { name: "お気に入り" })).toHaveLength(1);
  });

  it("変換中の Enter と Ctrl+Enter では開かない。Ctrl+Enter はお気に入りに渡す", async () => {
    const onSelect = vi.fn();
    const onFavorite = vi.fn(() => Promise.resolve(true));
    render(<CommandPalette onSelect={onSelect} onFavorite={onFavorite} />);
    fireEvent.change(input(), { target: { value: "止血" } });
    await screen.findByText("止血帯を使う");
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onFavorite).toHaveBeenCalledWith(HITS[0]);
    // 画面では星が変わるだけなので、結果を読み上げる
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "「止血帯を使う」をお気に入りに入れました",
      );
    });
  });

  it("該当がなければそう伝える。文は一覧（listbox）の外に出し、読み上げにも流す", async () => {
    render(<CommandPalette onSelect={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "なし" } });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("「なし」に一致する項目はありません");
    });
    const shown = screen
      .getAllByText("「なし」に一致する項目はありません")
      .filter((el) => el.getAttribute("role") !== "status");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.closest("[role=listbox]")).toBeNull();
  });

  it("結果の件数を読み上げ、一覧には名前を付ける", async () => {
    render(<CommandPalette onSelect={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "止血" } });
    await screen.findByText("止血帯を使う");
    expect(screen.getByRole("status").textContent).toBe(`${String(HITS.length)} 件`);
    expect(screen.getByRole("listbox", { name: "検索結果" })).toBeTruthy();
  });

  it("保存した絞り込みで検索し、絞り込み中の数を出す", async () => {
    useSearchFilter.setState({
      filter: { modTargets: ["core"], tags: [] },
    });
    render(<CommandPalette onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "絞り込み（1 件）" })).toBeTruthy();
    fireEvent.change(input(), { target: { value: "CPR" } });
    await waitFor(() => {
      expect(queries).toEqual([{ q: "CPR", filter: { modTargets: ["core"] } }]);
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

  it("1 回目の Esc では入力欄にフォーカスを残し、閉じた後の Esc で外す", () => {
    render(<CommandPalette variant="dropdown" onSelect={vi.fn()} />);
    input().focus();
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.activeElement).not.toBe(input());
  });

  it("フォーカスがパレットの外へ出たら閉じる（重ねた一覧で移った先を隠さない）", () => {
    render(
      <>
        <CommandPalette variant="dropdown" onSelect={vi.fn()} />
        <button type="button">本文のボタン</button>
      </>,
    );
    fireEvent.focus(input());
    expect(list()).not.toBeNull();
    fireEvent.blur(input(), {
      relatedTarget: screen.getByRole("button", { name: "本文のボタン" }),
    });
    expect(list()).toBeNull();
  });

  it("閉じている間は入力欄が無い一覧を指さず、開いたら一覧を指す", () => {
    render(<CommandPalette variant="dropdown" onSelect={vi.fn()} />);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-controls")).toBe(false);
    fireEvent.focus(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-controls")).toBe(list()?.id);
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-controls")).toBe(false);
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

  it("空のときの中身から開いても、一覧を閉じて開く先を渡す", () => {
    const onSelect = vi.fn();
    render(
      <CommandPalette variant="dropdown" onSelect={onSelect} emptySlot={<RecentFlowButton />} />,
    );
    fireEvent.focus(input());
    fireEvent.click(screen.getByText("最近見たフロー"));
    expect(onSelect).toHaveBeenCalledWith("/triage/first-contact");
    expect(list()).toBeNull();
  });
});
