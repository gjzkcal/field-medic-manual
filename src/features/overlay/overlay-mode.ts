// 小窓の呼び出しのモードと、画面の行き先。ルーターに依存しない純粋な関数にしてテストする。
import { create } from "zustand";

import type { OverlayMode } from "@/lib/bindings/OverlayMode";
import type { PrefItem } from "@/lib/bindings/PrefItem";

export const OVERLAY_SEARCH_PATH = "/search";
export const OVERLAY_TRIAGE_PATH = "/triage";
export const OVERLAY_FAVORITES_PATH = "/favorites";
export const OVERLAY_QUICKREF_PATH = "/quickref";

/** モードで移る先。閲覧（Ctrl+Shift+M）は前に見ていた画面をそのまま出すので null。 */
export function hrefForMode(mode: OverlayMode, history: readonly PrefItem[]): string | null {
  switch (mode) {
    case "view":
      return null;
    case "search":
      return OVERLAY_SEARCH_PATH;
    case "triage": {
      // 途中の状態（?path=）は付けず、最初から始める（前の負傷者の続きを出さないため）
      const flow = history.find((item) => item.target.kind === "flow")?.target;
      return flow?.kind === "flow"
        ? `${OVERLAY_TRIAGE_PATH}/${encodeURIComponent(flow.flowId)}`
        : OVERLAY_TRIAGE_PATH;
    }
  }
}

interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}

/** 「メインで開く」の行き先。メインにもある画面はそのまま、小窓にしかない画面はライブラリにする。 */
export function mainHrefOf(location: LocationLike): string {
  const { pathname, search, hash } = location;
  if (
    pathname.startsWith("/doc/") ||
    pathname.startsWith(OVERLAY_TRIAGE_PATH) ||
    pathname === OVERLAY_QUICKREF_PATH
  ) {
    return `${pathname}${search}${hash}`;
  }
  return "/library";
}

interface OverlayUiState {
  /** 検索欄へのフォーカスの要求。Ctrl+Shift+F のたびに増やし、検索の画面が見て入力欄へ移す */
  searchFocusRequest: number;
  /** 検索の入力。結果を開いて戻ったときに残すため、画面の外で持つ */
  searchQuery: string;
}

export const useOverlayUi = create<OverlayUiState>()(() => ({
  searchFocusRequest: 0,
  searchQuery: "",
}));

export function requestSearchFocus(): void {
  useOverlayUi.setState((s) => ({ searchFocusRequest: s.searchFocusRequest + 1 }));
}
