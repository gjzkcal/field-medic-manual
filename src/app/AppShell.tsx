import { HeartPulseIcon, type LibraryIcon, MenuIcon } from "lucide-react";
import { useRef, type JSX, type ReactNode, type RefObject } from "react";
import { Link, matchPath, Outlet, useLocation } from "react-router";

import { LinkButton } from "@/components/LinkButton";
import { useUiStore } from "@/app/store";
import { focusPageStart, useRouteFocus } from "@/app/use-route-focus";
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
  /** 狭い画面の引き出しだけで、ナビの末尾に足す項目（ヘッダーに置けなくなったものの移し先） */
  mobileNavEnd?: ReactNode;
}

// 自分で列ごとのスクロールを持つ画面。ビューアは本文だけをスクロールさせ、ツリーと目次を止めておくため
const FULL_HEIGHT_PATTERNS: readonly string[] = ["/doc/:id"];

/** ヘッダー・サイドバー・本文の枠。デスクトップ版（Layout）と Web 版（WebLayout）で共有する。 */
export function AppShell({
  navItems,
  headerEnd,
  sidebarFooter,
  mobileNavEnd,
}: AppShellProps): JSX.Element {
  const { pathname } = useLocation();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);

  return (
    // ヘッダーのメニューボタンからサイドバーを開けるよう、Provider でヘッダーごと包む。
    // ヘッダーの高さを変数にして、サイドバーの開始位置と高さを同じ値から計算する（ずれを防ぐため）
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="h-svh flex-col [--header-height:--spacing(12)]"
    >
      <SkipLink main={mainRef} />
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
        <MobileMenuTrigger />
      </header>
      {/* Sidebar と SidebarInset は兄弟のまま置く（本文の余白をサイドバーの開閉に合わせる peer の指定が効くように） */}
      <div className="flex min-h-0 flex-1">
        <ShellSidebar
          navItems={navItems}
          pathname={pathname}
          sidebarFooter={sidebarFooter}
          mobileNavEnd={mobileNavEnd}
          open={sidebarOpen}
        />
        <SidebarInset ref={mainRef} id={MAIN_ID} className="min-h-0 min-w-0">
          {FULL_HEIGHT_PATTERNS.some((pattern) => matchPath(pattern, pathname) !== null) ? (
            <div className="min-h-0 flex-1">
              <Outlet />
            </div>
          ) : (
            // 画面ごとに作り直し、前の画面のスクロールの位置を持ち越さない
            <ScrollArea key={pathname} className="min-h-0 flex-1">
              <div className="p-6 max-sm:p-4">
                <Outlet />
              </div>
            </ScrollArea>
          )}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

const MAIN_ID = "main-content";

/**
 * キーボードで最初に届く「本文へスキップ」（WCAG 2.4.1）。ヘッダーの検索とサイドバーの項目を毎回たどらずに済むようにする。
 * フォーカスが来たときだけ見せる。ページ内リンクとして URL のアンカーを変えると原稿の見出しへの移動と混ざるので、押したら直接移す
 */
function SkipLink({ main }: { main: RefObject<HTMLElement | null> }): JSX.Element {
  return (
    <div className="fixed top-2 left-2 z-50 not-focus-within:sr-only">
      <LinkButton
        variant="outline"
        render={
          <a
            href={`#${MAIN_ID}`}
            onClick={(event) => {
              event.preventDefault();
              if (main.current !== null) {
                focusPageStart(main.current);
              }
            }}
          />
        }
      >
        本文へスキップ
      </LinkButton>
    </div>
  );
}

/**
 * 狭い画面（md 未満。shadcn のサイドバーが引き出しになる幅）でヘッダーの右端に出す、引き出しを開くボタン。
 * スマホなどで開いた Web 版のほか、デスクトップ版でもウィンドウを狭めたときや Ctrl+± で拡大したときに出る。
 */
function MobileMenuTrigger(): JSX.Element | null {
  const { isMobile, openMobile, toggleSidebar } = useSidebar();
  if (!isMobile) {
    return null;
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mr-3"
      aria-label="メニューを開く"
      aria-expanded={openMobile}
      onClick={toggleSidebar}
    >
      <MenuIcon />
    </Button>
  );
}

function ShellSidebar({
  navItems,
  pathname,
  sidebarFooter,
  mobileNavEnd,
  open,
}: {
  navItems: readonly NavItem[];
  pathname: string;
  sidebarFooter: ReactNode;
  mobileNavEnd: ReactNode;
  open: boolean;
}): JSX.Element {
  const { isMobile } = useSidebar();
  return (
    // 引き出しは、開くボタンのある右から出す。広い画面では今までどおり左に置く。
    // 閉じてもアイコンの帯を残し、右下の開閉ボタンから開き直せるようにする。
    // shadcn のサイドバーは画面の上端から固定配置なので、ヘッダーの下から始まるよう位置と高さを上書きする
    <Sidebar
      side={isMobile ? "right" : "left"}
      collapsible="icon"
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]! select-none"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu items={navItems} pathname={pathname} end={isMobile ? mobileNavEnd : null} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="flex-row items-center justify-between group-data-[collapsible=icon]:justify-center">
        <div className="min-w-0 group-data-[collapsible=icon]:hidden">{sidebarFooter}</div>
        {/* 引き出しは背景のタップや項目の選択で閉じる。左の帯を折りたたむためのボタンは右の引き出しに合わないので出さない */}
        {!isMobile && <SidebarToggle open={open} />}
      </SidebarFooter>
    </Sidebar>
  );
}

function NavMenu({
  items,
  pathname,
  end,
}: {
  items: readonly NavItem[];
  pathname: string;
  end: ReactNode;
}): JSX.Element {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    // 原稿を開いているときもライブラリを今の画面として伝える（NavLink は URL が完全に一致するときしか aria-current を付けない）
    <nav aria-label="メイン">
      <SidebarMenu>
        {items.map((item) => {
          const active = item.activePatterns.some(
            (pattern) => matchPath(pattern, pathname) !== null,
          );
          return (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={active}
                render={<Link to={item.to} aria-current={active ? "page" : undefined} />}
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
          );
        })}
        {end}
      </SidebarMenu>
    </nav>
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
