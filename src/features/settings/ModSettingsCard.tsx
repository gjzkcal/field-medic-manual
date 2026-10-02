import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MOD_TARGET_LABELS } from "@/features/content/meta";
import {
  SELECTABLE_MODS,
  useModSettings,
  type SelectableMod,
} from "@/features/settings/mod-settings";

const MOD_DESCRIPTIONS: Record<SelectableMod, string> = {
  hitzones: "臓器（心臓・大腿動脈）への被弾を判定する",
  circulation: "心拍・血圧、心停止と CPR、薬の効き方が変わる",
  breathing: "気道閉塞と気胸が起きる",
  ai: "AI の衛生兵が意識不明の味方を治療する",
};

/** 使っている ACE Medical の MOD。トリアージのフローはこの設定で自動に分岐する。 */
export function ModSettingsCard(): JSX.Element {
  const enabled = useModSettings((s) => s.settings.enabled);
  const setEnabled = useModSettings((s) => s.setEnabled);
  const storageError = useModSettings((s) => s.storageError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>使っている MOD</CardTitle>
        <CardDescription>
          遊んでいるサーバーに入っている ACE Medical の MOD。トリアージのフローは、MOD
          を入れているかを尋ねずに、この設定で分岐します。マニュアルとクイック表は、この組み合わせに合う節と行だけを表示します。Core
          は常に入っているものとします。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {SELECTABLE_MODS.map((mod) => (
          <div key={mod} className="flex max-w-sm flex-col gap-0.5">
            {/* Switch は囲んだ label の文字を名前にするので、説明文は label の外に置いて名前を MOD 名だけにする */}
            <label className="flex items-center justify-between gap-4 text-sm font-medium">
              {MOD_TARGET_LABELS[mod]}
              <Switch
                checked={enabled.includes(mod)}
                onCheckedChange={(checked) => {
                  setEnabled(mod, checked);
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">{MOD_DESCRIPTIONS[mod]}</p>
          </div>
        ))}
        {storageError !== null && (
          <p role="alert" className="text-sm text-destructive">
            設定を保存できませんでした: {storageError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
