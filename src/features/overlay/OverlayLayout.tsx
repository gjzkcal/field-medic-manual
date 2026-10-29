import {
  AppWindowIcon,
  EyeOffIcon,
  SearchIcon,
  StarIcon,
  TableIcon,
  WorkflowIcon,
} from "lucide-react";
import { useRef, type JSX } from "react";
import { matchPath, NavLink, Outlet, useLocation } from "react-router";

import { useRouteFocus } from "@/app/use-route-focus";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  mainHrefOf,
  OVERLAY_FAVORITES_PATH,
  OVERLAY_QUICKREF_PATH,
  OVERLAY_SEARCH_PATH,
  OVERLAY_TRIAGE_PATH,
} from "@/features/overlay/overlay-mode";
import { windowHide, windowOpenInMain } from "@/lib/tauri";

interface OverlayTab {
  to: string;
  label: string;
  icon: typeof SearchIcon;
  // 検索から開いたビューアは検索のタブの続きとして扱う
  activePatterns: readonly string[];
}

const TABS: readonly OverlayTab[] = [
  {
    to: OVERLAY_SEARCH_PATH,
    label: "検索",
    icon: SearchIcon,
    activePatterns: [OVERLAY_SEARCH_PATH, "/doc/*"],
  },
  {
    to: OVERLAY_TRIAGE_PATH,
    label: "トリアージ",
    icon: WorkflowIcon,
    activePatterns: [OVERLAY_TRIAGE_PATH, `${OVERLAY_TRIAGE_PATH}/*`],
  },
  {
    to: OVERLAY_QUICKREF_PATH,
    label: "クイック表",
    icon: TableIcon,
    activePatterns: [OVERLAY_QUICKREF_PATH],
  },
  {
    to: OVERLAY_FAVORITES_PATH,
    label: "お気に入り",
    icon: StarIcon,
    activePatterns: [OVERLAY_FAVORITES_PATH],
  },
];

// 自分でスクロールを持つ画面。ビューアは本文だけを、検索は結果の一覧だけをスクロールさせる
const FULL_HEIGHT_PATTERNS: readonly string[] = ["/doc/:id", OVERLAY_SEARCH_PATH];

/** 小窓の枠。上部の帯がタイトルバーを兼ね、タブ・メインで開く・隠すを置く。 */
export function OverlayLayout(): JSX.Element {
  const location = useLocation();
  const fullHeight = FULL_HEIGHT_PATTERNS.some(
    (pattern) => matchPath(pattern, location.pathname) !== null,
  );
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);

  return (
    <div className="flex h-svh flex-col">
      {/* data-tauri-drag-region は付けた要素そのものにしか効かないので、帯と余白の両方に付ける */}
      <header
        data-tauri-drag-region
        className="@container flex h-10 shrink-0 items-center gap-1 border-b px-1 select-none"
      >
        <nav aria-label="小窓の画面" className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = tab.activePatterns.some(
              (pattern) => matchPath(pattern, location.pathname) !== null,
            );
            return (
              <Button
                key={tab.to}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                nativeButton={false}
                render={<NavLink to={tab.to} />}
                aria-current={active ? "page" : undefined}
              >
                <tab.icon />
                {/* 小窓は幅 320px まで縮められる。狭いと帯に収まらないので、文字は読み上げ用にだけ残してアイコンにする */}
                <span className="@max-[26rem]:sr-only">{tab.label}</span>
              </Button>
            );
          })}
        </nav>
        <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="メインウィンドウで開く"
                onClick={() => {
                  void windowOpenInMain(mainHrefOf(location));
                }}
              />
            }
          >
            <AppWindowIcon />
          </TooltipTrigger>
          <TooltipContent>メインウィンドウで開く</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="小窓を隠す"
                onClick={() => {
                  void windowHide();
                }}
              />
            }
          >
            <EyeOffIcon />
          </TooltipTrigger>
          <TooltipContent>小窓を隠す（ホットキーでまた出せます）</TooltipContent>
        </Tooltip>
      </header>
      <main ref={mainRef} className="flex min-h-0 flex-1 flex-col">
        {fullHeight ? (
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        ) : (
          // 画面ごとに作り直し、前の画面のスクロールの位置を持ち越さない
          <ScrollArea key={location.pathname} className="min-h-0 flex-1">
            <div className="p-4">
              <Outlet />
            </div>
          </ScrollArea>
        )}
      </main>
    </div>
  );
}
