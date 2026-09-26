import { AppWindowIcon, EyeOffIcon, SearchIcon, StarIcon, WorkflowIcon } from "lucide-react";
import type { JSX } from "react";
import { matchPath, NavLink, Outlet, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  mainHrefOf,
  OVERLAY_FAVORITES_PATH,
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

// クイック表のタブは Step 06 で足す
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

  return (
    <div className="flex h-svh flex-col">
      {/* data-tauri-drag-region は付けた要素そのものにしか効かないので、帯と余白の両方に付ける */}
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-1 border-b px-1 select-none"
      >
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
              {tab.label}
            </Button>
          );
        })}
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
      {fullHeight ? (
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            <Outlet />
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
