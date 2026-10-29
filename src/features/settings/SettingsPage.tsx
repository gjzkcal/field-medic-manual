import type { JSX } from "react";

import { usePageTitle } from "@/app/use-page-title";
import { AboutCard } from "@/features/settings/AboutCard";
import { DebugPanel } from "@/features/settings/debug/DebugPanel";
import { HotkeySettings } from "@/features/settings/HotkeySettings";
import { ModSettingsCard } from "@/features/settings/ModSettingsCard";
import { OverlaySettingsCard } from "@/features/settings/OverlaySettingsCard";
import { TriageSettingsCard } from "@/features/settings/TriageSettingsCard";
import { ViewerSettingsCard } from "@/features/settings/ViewerSettingsCard";

export function SettingsPage(): JSX.Element {
  usePageTitle("設定");
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">設定</h1>
      <ViewerSettingsCard />
      <ModSettingsCard />
      <TriageSettingsCard />
      <HotkeySettings />
      <OverlaySettingsCard />
      <AboutCard />
      {/* 配布版に開発用の操作を出さないため、開発ビルドだけで表示する */}
      {import.meta.env.DEV && <DebugPanel />}
    </section>
  );
}
