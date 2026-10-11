// Web 版（GitHub Pages）のエントリ。vite --mode web のときに index.html がこのファイルを読む。
// デスクトップ版のエントリ（src/main.tsx）と違い、小窓・同梱物の DB への同期・自動更新・お気に入りを起動しない
import "@/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { loadQuickrefSettings } from "@/features/quickref/quickref-settings";
import { loadSearchFilter } from "@/features/search/search-filter";
import { loadModSettings } from "@/features/settings/mod-settings";
import { loadViewerSettings } from "@/features/settings/viewer-settings";
import { WebApp } from "@/web/WebApp";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root が見つかりません。index.html を確認してください。");
}

// 設定は localStorage から読む。描画を待たせないため、読み終わるまでの一瞬は既定値で表示する
void loadViewerSettings();
void loadSearchFilter();
void loadModSettings();
void loadQuickrefSettings();

createRoot(rootElement).render(
  <StrictMode>
    <WebApp />
  </StrictMode>,
);
