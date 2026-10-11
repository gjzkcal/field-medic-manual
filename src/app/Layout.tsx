import { LibraryIcon, SettingsIcon, TableIcon, WorkflowIcon } from "lucide-react";
import { useEffect, type JSX } from "react";
import { useNavigate } from "react-router";

import { AppShell, type NavItem } from "@/app/AppShell";
import { AppVersion } from "@/app/AppVersion";
import { WindowControls } from "@/app/WindowControls";
import { onOpenHref } from "@/lib/tauri";

const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/library",
    label: "ライブラリ",
    icon: LibraryIcon,
    activePatterns: ["/library", "/doc/*"],
  },
  { to: "/quickref", label: "クイック表", icon: TableIcon, activePatterns: ["/quickref"] },
  { to: "/triage", label: "トリアージ", icon: WorkflowIcon, activePatterns: ["/triage/*"] },
  { to: "/settings", label: "設定", icon: SettingsIcon, activePatterns: ["/settings"] },
];

/** 小窓の「メインで開く」とトレイの「設定」から、この画面へ移る。 */
function useOpenHrefFromRust(): void {
  const navigate = useNavigate();
  useEffect(() => {
    // アンマウント後（StrictMode の二重実行を含む）に購読を残さないため
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onOpenHref((href) => {
      void navigate(href);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // 受け取れなくても、メインの画面は普通に使える
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);
}

/** デスクトップ版のメインウィンドウの枠。 */
export function Layout(): JSX.Element {
  useOpenHrefFromRust();
  return (
    <AppShell navItems={NAV_ITEMS} headerEnd={<WindowControls />} sidebarFooter={<AppVersion />} />
  );
}
