import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OverdoseLineToggle } from "@/features/casualties/OverdoseLineToggle";
import { SettingsSaveError } from "@/features/settings/SettingsSaveError";
import { useViewerSettings } from "@/features/settings/viewer-settings";

/** 負傷者の画面の設定。カードの上の帯でも同じ値を切り替えられる。 */
export function CasualtySettingsCard(): JSX.Element {
  const storageError = useViewerSettings((s) => s.storageError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>負傷者</h2>
        </CardTitle>
        <CardDescription>
          薬のカードの「N 本まで OK」を、どちらの基準の本数で出すか（Circulation のとき）。
          意識喪失は、心停止と同じか少ない本数で起きます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <OverdoseLineToggle />
        <SettingsSaveError error={storageError} />
      </CardContent>
    </Card>
  );
}
