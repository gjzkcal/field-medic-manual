import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SettingsSaveError } from "@/features/settings/SettingsSaveError";
import { useViewerSettings } from "@/features/settings/viewer-settings";
import { IS_WEB } from "@/lib/platform";

/** 何のキー操作か（カードの説明にも、節の説明にも使う）。 */
export const TRIAGE_KEYS_SUMMARY = `${
  IS_WEB ? "実行画面" : "実行画面と小窓"
}のキー操作。オフにしても、ボタンと Enter・Backspace・Esc は使えます。`;

/** トリアージの数字キーと Space の切り替え。保存のエラーは、置いたカードが出す。 */
export function TriageKeysField(): JSX.Element {
  const triageKeys = useViewerSettings((s) => s.settings.triageKeys);
  const update = useViewerSettings((s) => s.update);

  return (
    <div className="flex max-w-sm flex-col gap-0.5">
      {/* Switch は囲んだ label の文字を名前にするので、説明文は label の外に置く */}
      <label className="flex items-center justify-between gap-4 text-sm font-medium">
        数字キーと Space で操作する
        <Switch
          checked={triageKeys}
          onCheckedChange={(checked) => {
            update({ triageKeys: checked });
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        数字キーで選択肢を選び、Space
        でタイマーを開始・一時停止する。音声入力などで意図せず進むときはオフにする
      </p>
    </div>
  );
}

/** トリアージの実行画面のキー操作（Web 版の設定。デスクトップ版は「キー操作」のカードにまとめる）。 */
export function TriageSettingsCard(): JSX.Element {
  const storageError = useViewerSettings((s) => s.storageError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>トリアージ</h2>
        </CardTitle>
        <CardDescription>{TRIAGE_KEYS_SUMMARY}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TriageKeysField />
        <SettingsSaveError error={storageError} />
      </CardContent>
    </Card>
  );
}
