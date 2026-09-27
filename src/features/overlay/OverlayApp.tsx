import { useEffect, type JSX, type PointerEvent } from "react";
import { createMemoryRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DocPage } from "@/features/library/DocPage";
import {
  hrefForMode,
  OVERLAY_SEARCH_PATH,
  requestSearchFocus,
} from "@/features/overlay/overlay-mode";
import { OverlayFavoritesPage } from "@/features/overlay/OverlayFavoritesPage";
import { OverlayLayout } from "@/features/overlay/OverlayLayout";
import { OverlaySearchPage } from "@/features/overlay/OverlaySearchPage";
import { refreshPrefs } from "@/features/prefs/prefs-store";
import { loadSearchFilter } from "@/features/search/search-filter";
import { loadModSettings } from "@/features/settings/mod-settings";
import { loadOverlaySettings, useOverlaySettings } from "@/features/settings/overlay-settings";
import { loadViewerSettings } from "@/features/settings/viewer-settings";
import { isTextEntry } from "@/features/triage/keyboard";
import { TriageListPage } from "@/features/triage/TriageListPage";
import { TriageRunPage } from "@/features/triage/TriageRunPage";
import type { OverlayMode } from "@/lib/bindings/OverlayMode";
import { historyList, onOverlayMode, overlayActivate } from "@/lib/tauri";

/** 直近のフローを探すときに見る履歴の数。最近見たもの（8 件）より深く見て、文書ばかり開いた後でも見つける */
const TRIAGE_HISTORY_DEPTH = 50;

// 小窓の URL はウィンドウの外に出ないので、メモリ上の履歴で持つ。画面はメインと同じ部品を使う
const overlayRouter = createMemoryRouter(
  [
    {
      element: <OverlayLayout />,
      children: [
        { index: true, element: <Navigate to={OVERLAY_SEARCH_PATH} replace /> },
        { path: "search", element: <OverlaySearchPage /> },
        { path: "doc/:id", element: <DocPage /> },
        { path: "triage", element: <TriageListPage /> },
        { path: "triage/:id", element: <TriageRunPage /> },
        { path: "favorites", element: <OverlayFavoritesPage /> },
        // メインの画面へのリンク（ビューアの「ライブラリ」など）は、小窓では検索に置き換える
        { path: "*", element: <Navigate to={OVERLAY_SEARCH_PATH} replace /> },
      ],
    },
  ],
  { initialEntries: [OVERLAY_SEARCH_PATH] },
);

/** 呼び出されたとき。設定はメインで変えるので、出すたびに読み直す。 */
async function handleOverlayMode(mode: OverlayMode): Promise<void> {
  void loadViewerSettings(true);
  void loadSearchFilter(true);
  void loadOverlaySettings();
  void loadModSettings();
  void refreshPrefs();
  const history = mode === "triage" ? await historyList(TRIAGE_HISTORY_DEPTH).catch(() => []) : [];
  const href = hrefForMode(mode, history);
  if (href !== null) {
    await overlayRouter.navigate(href);
  }
  if (mode === "search") {
    requestSearchFocus();
  }
}

export function OverlayApp(): JSX.Element {
  const opacity = useOverlaySettings((s) => s.overlay.opacity);

  useEffect(() => {
    // アンマウント後（StrictMode の二重実行を含む）に購読を残さないため
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onOverlayMode((mode) => {
      void handleOverlayMode(mode);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // 受け取れなくても、小窓はタブの操作で使える
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 閲覧モード（フォーカスしない表示）では、押してもキー入力はゲームなど前面のアプリに届く。
  // 文字を打つ場所を押したときだけ、小窓にフォーカスを移す
  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (isTextEntry(event.target)) {
      overlayActivate().catch(() => {
        // 移せなくても、ホットキーの検索モード（Ctrl+Shift+F）で打てる
      });
    }
  }

  return (
    <TooltipProvider>
      <div
        className="h-svh text-foreground"
        // 背景だけを透かし、文字は不透明のまま読めるようにする（ウィンドウは透明にしてある）
        style={{
          backgroundColor: `color-mix(in oklab, var(--background) ${String(opacity)}%, transparent)`,
        }}
        onPointerDown={handlePointerDown}
      >
        <RouterProvider router={overlayRouter} />
      </div>
    </TooltipProvider>
  );
}
