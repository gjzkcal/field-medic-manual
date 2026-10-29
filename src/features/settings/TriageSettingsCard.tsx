import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useViewerSettings } from "@/features/settings/viewer-settings";

/** トリアージの実行画面のキー操作。デスクトップ版だけ（Web 版にトリアージは無い）。 */
export function TriageSettingsCard(): JSX.Element {
  const triageKeys = useViewerSettings((s) => s.settings.triageKeys);
  const update = useViewerSettings((s) => s.update);
  const storageError = useViewerSettings((s) => s.storageError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>トリアージ</h2>
        </CardTitle>
        <CardDescription>
          実行画面と小窓のキー操作。オフにしても、ボタンと Enter・Backspace・Esc は使えます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        {storageError !== null && (
          <p role="alert" className="text-sm text-destructive">
            設定を保存できませんでした: {storageError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
