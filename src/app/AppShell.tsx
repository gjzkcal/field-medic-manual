import { HeartPulseIcon, type LibraryIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { matchPath, NavLink, Outlet, useLocation } from "react-router";

import { useUiStore } from "@/app/store";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HeaderSearch } from "@/features/search/HeaderSearch";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LibraryIcon;
  // ドキュメント閲覧（/doc/:id）はライブラリの下位画面として扱い、ナビではライブラリを選択中にするため
  activePatterns: readonly string[];
}

interface AppShellProps {
  navItems: readonly NavItem[];
  /** ヘッダーの右端（デスクトップ版はウィンドウの操作、Web 版はダウンロードの案内） */
  headerEnd: ReactNode;
  /** サイドバーの下端の左（開閉ボタンの隣）。折りたたむと隠れる */
  sidebarFooter: ReactNode;
}

// 自分で列ごとのスクロールを持つ画面。ビューアは本文だけをスクロールさせ、ツリーと目次を止めておくため
const FULL_HEIGHT_PATTERNS: readonly string[] = ["/doc/:id"];

/** ヘッダー・サイドバー・本文の枠。デスクトップ版（Layout）と Web 版（WebLayout）で共有する。 */
export function AppShell({ navItems, headerEnd, sidebarFooter }: AppShellProps): JSX.Element {
  const { pathname } = useLocation();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);

  return (
    // ヘッダーの高さを変数にして、サイドバーの開始位置と高さを同じ値から計算する（ずれを防ぐため）
    <div className="flex h-svh flex-col [--header-height:--spacing(12)]">
      {/* ウィンドウ全幅のヘッダーがタイトルバーを兼ねる。data-tauri-drag-region は付けた要素そのものにしか効かないため、
          アプリ名はクリックを透過させてヘッダーで受け、余白用の div にも付ける */}
      <header
        data-tauri-drag-region
        className="flex h-(--header-height) shrink-0 items-center gap-2 border-b pl-4 select-none"
      >
        <HeartPulseIcon className="pointer-events-none size-5 shrink-0" />
        {/* 狭い画面（Web 版をスマホで開いたとき）では、検索欄の幅を確保するためにアイコンだけにする */}
        <span className="pointer-events-none shrink-0 text-base font-semibold max-sm:hidden">
          Field Medic Manual
        </span>
        <div data-tauri-drag-region className="h-full min-w-8 flex-1 max-sm:min-w-2" />
        <HeaderSearch />
        <div data-tauri-drag-region className="h-full min-w-8 flex-1 max-sm:min-w-2" />
        {headerEnd}
      </header>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} className="min-h-0 flex-1">
        {/* 閉じてもアイコンの帯を残し、右下の開閉ボタンから開き直せるようにする。
            shadcn のサイドバーは画面の上端から固定配置なので、ヘッダーの下から始まるよう位置と高さを上書きする */}
        <Sidebar
          collapsible="icon"
          className="top-(--header-height) h-[calc(100svh-var(--header-height))]! select-none"
        >
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <NavMenu items={navItems} pathname={pathname} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="flex-row items-center justify-between group-data-[collapsible=icon]:justify-center">
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">{sidebarFooter}</div>
            <SidebarToggle open={sidebarOpen} />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-h-0 min-w-0">
          {/* shadcn のサイドバーは md 未満で引き出しになり、中の開閉ボタンが見えなくなる。
              デスクトップ版のウィンドウは最小幅がそれより広いので、これが出るのはスマホなどで開いた Web 版だけ */}
          <div className="flex shrink-0 items-center border-b px-2 py-1 md:hidden">
            <SidebarTrigger aria-label="メニューを開く" />
          </div>
          {FULL_HEIGHT_PATTERNS.some((pattern) => matchPath(pattern, pathname) !== null) ? (
            <div className="min-h-0 flex-1">
              <Outlet />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-6 max-sm:p-4">
                <Outlet />
              </div>
            </ScrollArea>
          )}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

function NavMenu({
  items,
  pathname,
}: {
  items: readonly NavItem[];
  pathname: string;
}): JSX.Element {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            isActive={item.activePatterns.some((pattern) => matchPath(pattern, pathname) !== null)}
            render={<NavLink to={item.to} />}
            tooltip={item.label}
            onClick={() => {
              // 引き出し（狭い画面の Web 版）は項目を選んでも開いたままなので、移った先の画面が見えるように閉じる
              if (isMobile) {
                setOpenMobile(false);
              }
            }}
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function SidebarToggle({ open }: { open: boolean }): JSX.Element {
  const label = open ? "サイドバーを折りたたむ" : "サイドバーを開く";
  return (
    <Tooltip>
      <TooltipTrigger render={<SidebarTrigger aria-label={label} />} />
      <TooltipContent side="right">
        {label}
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>B</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}
