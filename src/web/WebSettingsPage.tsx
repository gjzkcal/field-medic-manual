import type { JSX } from "react";

import { usePageTitle } from "@/app/use-page-title";
import { ModSettingsCard } from "@/features/settings/ModSettingsCard";
import { ViewerSettingsCard } from "@/features/settings/ViewerSettingsCard";

/** Web 版の設定。ホットキー・小窓・更新はデスクトップ版だけなので、表示と MOD だけにする。 */
export function WebSettingsPage(): JSX.Element {
  usePageTitle("設定");
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">設定</h1>
      <p className="text-sm text-muted-foreground">設定はこのブラウザに保存されます。</p>
      <ViewerSettingsCard />
      <ModSettingsCard />
    </section>
  );
}
