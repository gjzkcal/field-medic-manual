import { DownloadIcon, InfoIcon, LibraryIcon, SettingsIcon, TableIcon } from "lucide-react";
import type { JSX } from "react";
import { Link } from "react-router";

import { LinkButton } from "@/components/LinkButton";
import { AppShell, type NavItem } from "@/app/AppShell";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { version } from "../../package.json";
import { DOWNLOAD_URL } from "@/web/links";

const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/library",
    label: "ライブラリ",
    icon: LibraryIcon,
    activePatterns: ["/library", "/doc/*"],
  },
  { to: "/quickref", label: "クイック表", icon: TableIcon, activePatterns: ["/quickref"] },
  { to: "/settings", label: "設定", icon: SettingsIcon, activePatterns: ["/settings"] },
  { to: "/about", label: "このサイトについて", icon: InfoIcon, activePatterns: ["/about"] },
];

/** Web 版の枠。ウィンドウの操作の代わりにデスクトップ版の案内を置き、サイドバーの下に短い免責を出す。 */
export function WebLayout(): JSX.Element {
  return (
    <AppShell
      navItems={NAV_ITEMS}
      headerEnd={
        // 狭い画面ではこの位置にメニューのボタンが出るので、案内はメニューの中（mobileNavEnd）に移す
        <LinkButton
          variant="outline"
          size="sm"
          className="mr-3 max-md:hidden"
          render={<a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />}
        >
          <DownloadIcon />
          デスクトップ版
        </LinkButton>
      }
      sidebarFooter={<WebFooter />}
      mobileNavEnd={
        <SidebarMenuItem>
          <SidebarMenuButton
            render={<a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />}
          >
            <DownloadIcon />
            <span>デスクトップ版をダウンロード</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      }
    />
  );
}

function WebFooter(): JSX.Element {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <div className="flex flex-col gap-1 px-2 text-xs text-muted-foreground">
      <span>v{version}（Web 版）</span>
      {/* 公開するサイトには、Bohemia と ACE チームとは無関係であることを常に見える所に出す。全文は「このサイトについて」 */}
      <p>
        非公式のマニュアルです。Bohemia Interactive・ACE チームとは関係ありません。
        <Link
          to="/about"
          className="underline underline-offset-2"
          onClick={() => {
            // 狭い画面の引き出しから移ったときに、移った先の画面が見えるように閉じる
            if (isMobile) {
              setOpenMobile(false);
            }
          }}
        >
          詳しく
        </Link>
      </p>
    </div>
  );
}
