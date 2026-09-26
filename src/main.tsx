import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { syncBundledManuals } from "@/features/content/sync";
import { loadViewerSettings } from "@/features/settings/viewer-settings";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root が見つかりません。index.html を確認してください。");
}

// 画面の表示を待たせないよう、同梱した原稿の同期は描画と並行して行う。結果は useContentSync で画面に出す
void syncBundledManuals();
// 表示設定も描画を待たせずに読む。読み終わるまでの一瞬は既定の文字サイズで表示される
void loadViewerSettings();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
