import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { syncBundledManuals } from "@/features/content/sync";
import { OverlayApp } from "@/features/overlay/OverlayApp";
import { refreshPrefs } from "@/features/prefs/prefs-store";
import { loadQuickrefSettings } from "@/features/quickref/quickref-settings";
import { syncBundledQuickref } from "@/features/quickref/sync";
import { loadSearchFilter } from "@/features/search/search-filter";
import { loadModSettings } from "@/features/settings/mod-settings";
import { loadOverlaySettings } from "@/features/settings/overlay-settings";
import { loadViewerSettings } from "@/features/settings/viewer-settings";
import { syncBundledFlows } from "@/features/triage/sync";
import { currentWindowLabel } from "@/lib/tauri";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root が見つかりません。index.html を確認してください。");
}

// メインと小窓は同じ index.html を読むので、ウィンドウのラベルで描く画面を分ける
const isOverlay = currentWindowLabel() === "overlay";

if (isOverlay) {
  // ウィンドウは透明にしてあり、背景は小窓の画面が不透明度を付けて塗る
  document.documentElement.classList.add("overlay-window");
} else {
  // 画面の表示を待たせないよう、同梱した原稿の同期は描画と並行して行う。結果は useContentSync で画面に出す。
  // 同期はメインだけで行う（2 つのウィンドウが同時に同じ原稿を書き込まないように）
  void syncBundledManuals();
  void syncBundledFlows();
  void syncBundledQuickref();
}
// 表示設定も描画を待たせずに読む。読み終わるまでの一瞬は既定の文字サイズで表示される
void loadViewerSettings();
void loadSearchFilter();
void loadOverlaySettings();
void loadModSettings();
void loadQuickrefSettings();
void refreshPrefs();

createRoot(rootElement).render(<StrictMode>{isOverlay ? <OverlayApp /> : <App />}</StrictMode>);
