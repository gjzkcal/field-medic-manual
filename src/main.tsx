import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { startClientErrorLog } from "@/lib/client-error-log";
import { waitForFirstScreen } from "@/app/reveal";
import { syncBundledManuals } from "@/features/content/sync";
import { OverlayApp } from "@/features/overlay/OverlayApp";
import { refreshPrefs } from "@/features/prefs/prefs-store";
import { loadQuickrefSettings } from "@/features/quickref/quickref-settings";
import { syncBundledQuickref } from "@/features/quickref/sync";
import { loadSearchFilter } from "@/features/search/search-filter";
import { loadModSettings } from "@/features/settings/mod-settings";
import { loadOverlaySettings } from "@/features/settings/overlay-settings";
import { startThemeSync } from "@/features/settings/theme";
import { loadViewerSettings, VIEWER_SETTINGS_KEY } from "@/features/settings/viewer-settings";
import { syncBundledFlows } from "@/features/triage/sync";
import { checkForUpdates } from "@/features/updater/update-store";
import { currentWindowLabel, onSettingsChanged } from "@/lib/tauri";

// 起動の処理の例外も拾えるよう、最初に始める
startClientErrorLog();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root が見つかりません。index.html を確認してください。");
}

// メインと小窓は同じ index.html を読むので、ウィンドウのラベルで描く画面を分ける
const isOverlay = currentWindowLabel() === "overlay";

// 既定（システム）のテーマを先に当て、保存した値は読み終えたときに当て直す
startThemeSync();
const viewerSettingsLoaded = loadViewerSettings();
// テーマと文字サイズは、もう一方のウィンドウ（メイン / 小窓）で変えてもすぐ反映する。
// ほかの設定は小窓を出すたびに読み直すので（OverlayApp）、ここでは追わない
void onSettingsChanged((key) => {
  if (key === VIEWER_SETTINGS_KEY) {
    void loadViewerSettings(true);
  }
}).catch(() => {
  // 受け取れなくても、小窓を出し直せば読み直す
});

if (isOverlay) {
  // ウィンドウは透明にしてあり、背景は小窓の画面が不透明度を付けて塗る
  document.documentElement.classList.add("overlay-window");
} else {
  // 保存したテーマで描いてから出す（違うテーマの画面を一瞬でも見せない）
  waitForFirstScreen(viewerSettingsLoaded);
  // 画面の表示を待たせないよう、同梱した原稿の同期は描画と並行して行う。結果は useContentSync で画面に出す。
  // 同期はメインだけで行う（2 つのウィンドウが同時に同じ原稿を書き込まないように）
  void syncBundledManuals();
  void syncBundledFlows();
  void syncBundledQuickref();
  // 更新の確認もメインだけで行う（小窓には updater の権限を与えていない）。
  // 開発ビルドは Releases の版と比べる意味がないので、起動時には確かめない（設定画面のボタンでは確かめられる）
  if (!import.meta.env.DEV) {
    void checkForUpdates({ manual: false });
  }
}
// ほかの設定も描画を待たせずに読む。読み終わるまでの一瞬は既定値で表示される
void loadSearchFilter();
void loadOverlaySettings();
void loadModSettings();
void loadQuickrefSettings();
void refreshPrefs();

createRoot(rootElement).render(<StrictMode>{isOverlay ? <OverlayApp /> : <App />}</StrictMode>);
