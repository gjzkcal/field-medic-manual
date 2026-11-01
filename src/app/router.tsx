import { createBrowserRouter, Navigate } from "react-router";

import { Layout } from "@/app/Layout";
import { RouteErrorPage } from "@/components/RouteErrorPage";
import { DocPage } from "@/features/library/DocPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { QuickrefPage } from "@/features/quickref/QuickrefPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TriageListPage } from "@/features/triage/TriageListPage";
import { TriageRunPage } from "@/features/triage/TriageRunPage";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        // 外側の受け皿は Layout ごと置き換わる。枠なしのウィンドウはタイトルバーが Layout にあるので、ページの失敗はここで受ける
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <Navigate to="/library" replace /> },
          { path: "library", element: <LibraryPage /> },
          { path: "doc/:id", element: <DocPage /> },
          { path: "quickref", element: <QuickrefPage /> },
          { path: "triage", element: <TriageListPage /> },
          { path: "triage/:id", element: <TriageRunPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <Navigate to="/library" replace /> },
        ],
      },
    ],
  },
]);
