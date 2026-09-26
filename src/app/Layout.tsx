import {
  HeartPulseIcon,
  LibraryIcon,
  SearchIcon,
  SettingsIcon,
  TableIcon,
  WorkflowIcon,
} from "lucide-react";
import type { JSX } from "react";
import { matchPath, NavLink, Outlet, useLocation } from "react-router";

import { AppVersion } from "@/app/AppVersion";
import { useUiStore } from "@/app/store";
import { WindowControls } from "@/app/WindowControls";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LibraryIcon;
  // ドキュメント閲覧（/doc/:id）はライブラリの下位画面として扱い、ナビではライブラリを選択中にするため
  activePatterns: readonly string[];
}

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

// 自分で列ごとのスクロールを持つ画面。ビューアは本文だけをスクロールさせ、ツリーと目次を止めておくため
const FULL_HEIGHT_PATTERNS: readonly string[] = ["/doc/:id"];

export function Layout(): JSX.Element {
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
        <span className="pointer-events-none shrink-0 text-base font-semibold">
          Field Medic Manual
        </span>
        <div data-tauri-drag-region className="h-full min-w-8 flex-1" />
        {/* 検索は Step 05 で実装する。場所だけ先に確保しておく。
            Button は既定で shrink-0 なので、shrink を付けないと狭いウィンドウで横にはみ出す */}
        <Button
          variant="outline"
          className="w-full max-w-xl min-w-0 shrink justify-start text-muted-foreground"
          disabled
        >
          <SearchIcon />
          <span className="truncate">マニュアルを検索…</span>
          <KbdGroup className="ml-auto">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <div data-tauri-drag-region className="h-full min-w-8 flex-1" />
        <WindowControls />
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
                <SidebarMenu>
                  {NAV_ITEMS.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={item.activePatterns.some(
                          (pattern) => matchPath(pattern, pathname) !== null,
                        )}
                        render={<NavLink to={item.to} />}
                        tooltip={item.label}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="flex-row items-center justify-between group-data-[collapsible=icon]:justify-center">
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <AppVersion />
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarTrigger
                    aria-label={sidebarOpen ? "サイドバーを折りたたむ" : "サイドバーを開く"}
                  />
                }
              />
              <TooltipContent side="right">
                {sidebarOpen ? "サイドバーを折りたたむ" : "サイドバーを開く"}
                <KbdGroup>
                  <Kbd>Ctrl</Kbd>
                  <Kbd>B</Kbd>
                </KbdGroup>
              </TooltipContent>
            </Tooltip>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-h-0 min-w-0">
          {FULL_HEIGHT_PATTERNS.some((pattern) => matchPath(pattern, pathname) !== null) ? (
            <div className="min-h-0 flex-1">
              <Outlet />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-6">
                <Outlet />
              </div>
            </ScrollArea>
          )}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
