import { createBrowserRouter, Navigate } from "react-router";

import { DocPage } from "@/features/library/DocPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { QuickrefPage } from "@/features/quickref/QuickrefPage";
import { WebAboutPage } from "@/web/WebAboutPage";
import { WebLayout } from "@/web/WebLayout";
import { WebSettingsPage } from "@/web/WebSettingsPage";

// 本文の URL は /doc/<id>?hl=<語>#<アンカー> なので、ハッシュで画面を切り替えるルーターは使えない。
// GitHub Pages ではリポジトリ名の下に置かれるので、その下を起点にする（末尾の / は付けない決まり）
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

export const webRouter = createBrowserRouter(
  [
    {
      element: <WebLayout />,
      children: [
        { index: true, element: <Navigate to="/library" replace /> },
        { path: "library", element: <LibraryPage /> },
        { path: "doc/:id", element: <DocPage /> },
        { path: "quickref", element: <QuickrefPage /> },
        { path: "settings", element: <WebSettingsPage /> },
        { path: "about", element: <WebAboutPage /> },
        // デスクトップ版の URL（/triage/… など）を共有されたときも、一覧から始められるようにする
        { path: "*", element: <Navigate to="/library" replace /> },
      ],
    },
  ],
  { basename: BASENAME },
);
