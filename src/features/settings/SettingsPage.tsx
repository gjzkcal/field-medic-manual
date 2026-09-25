import type { JSX } from "react";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { DebugPanel } from "@/features/settings/debug/DebugPanel";

export function SettingsPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PagePlaceholder title="設定" description="アプリの設定を表示します（Step 08 以降）。" />
      {/* 配布版に開発用の操作を出さないため、開発ビルドだけで表示する */}
      {import.meta.env.DEV && <DebugPanel />}
    </div>
  );
}
