import { useEffect, useRef, type JSX, type RefObject } from "react";
import { useLocation } from "react-router";

import { usePageTitle } from "@/app/use-page-title";
import { focusTarget } from "@/app/use-route-focus";
import { AboutCard } from "@/features/settings/AboutCard";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";
import { CasualtySettingsCard } from "@/features/settings/CasualtySettingsCard";
import { DataSettingsCard } from "@/features/settings/DataSettingsCard";
import { DebugPanel } from "@/features/settings/debug/DebugPanel";
import { KeyboardSettingsCard } from "@/features/settings/KeyboardSettingsCard";
import { ModSettingsCard } from "@/features/settings/ModSettingsCard";
import { ViewerSettingsCard } from "@/features/settings/ViewerSettingsCard";
import { WindowSettingsCard } from "@/features/settings/WindowSettingsCard";

/**
 * アドレスの `#…` が指すカードへ移る（AI チャットの「設定を開く」が `#ai` で来る）。
 * 画面の中だけで移るアプリなので、ブラウザのようにアンカーへは自動で移らない
 */
function useCardAnchor(): RefObject<HTMLElement | null> {
  const { hash } = useLocation();
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const card = hash === "" ? null : document.getElementById(hash.slice(1));
    if (card === null || rootRef.current?.contains(card) !== true) {
      return;
    }
    card.scrollIntoView({ block: "start" });
    // 読み上げとキーボードの位置も、移った先のカードに合わせる
    focusTarget(card.querySelector<HTMLElement>("h2") ?? card);
  }, [hash]);
  return rootRef;
}

export function SettingsPage(): JSX.Element {
  usePageTitle("設定");
  const rootRef = useCardAnchor();
  return (
    <section ref={rootRef} className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">設定</h1>
      <ViewerSettingsCard />
      <ModSettingsCard />
      <KeyboardSettingsCard />
      <WindowSettingsCard />
      <CasualtySettingsCard />
      <AiSettingsCard />
      <DataSettingsCard />
      <AboutCard />
      {/* 配布版に開発用の操作を出さないため、開発ビルドだけで表示する */}
      {import.meta.env.DEV && <DebugPanel />}
    </section>
  );
}
