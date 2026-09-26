import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { syncBundledManuals } from "@/features/content/sync";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root が見つかりません。index.html を確認してください。");
}

// 画面の表示を待たせないよう、同梱した原稿の同期は描画と並行して行う。結果は useContentSync で画面に出す
void syncBundledManuals();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
