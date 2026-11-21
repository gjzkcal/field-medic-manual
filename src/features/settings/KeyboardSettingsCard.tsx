import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HotkeyFields } from "@/features/settings/HotkeyFields";
import { SettingsSaveError } from "@/features/settings/SettingsSaveError";
import { SettingsSection } from "@/features/settings/SettingsSection";
import { TRIAGE_KEYS_SUMMARY, TriageKeysField } from "@/features/settings/TriageSettingsCard";
import { useViewerSettings } from "@/features/settings/viewer-settings";

/** キーボードでの操作の設定。ゲーム中に効くホットキーと、トリアージの画面の中のキー。 */
export function KeyboardSettingsCard(): JSX.Element {
  const storageError = useViewerSettings((s) => s.storageError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>キー操作</h2>
        </CardTitle>
        <CardDescription>
          小窓を呼び出すホットキーと、トリアージの画面で使うキーの設定です。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SettingsSection title="ホットキー">
          <HotkeyFields />
        </SettingsSection>
        <SettingsSection title="トリアージ">
          <p className="text-sm text-muted-foreground">{TRIAGE_KEYS_SUMMARY}</p>
          <TriageKeysField />
          <SettingsSaveError error={storageError} />
        </SettingsSection>
      </CardContent>
    </Card>
  );
}
