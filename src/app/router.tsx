import { createBrowserRouter, Navigate } from "react-router";

import { Layout } from "@/app/Layout";
import { DocPage } from "@/features/library/DocPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { QuickrefPage } from "@/features/quickref/QuickrefPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TriageListPage } from "@/features/triage/TriageListPage";
import { TriageRunPage } from "@/features/triage/TriageRunPage";

export const router = createBrowserRouter([
  {
    element: <Layout />,
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
]);
