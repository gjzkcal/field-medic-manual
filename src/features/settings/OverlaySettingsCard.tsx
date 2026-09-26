import { MonitorIcon } from "lucide-react";
import type { JSX } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { OPACITY_MAX, OPACITY_MIN, useOverlaySettings } from "@/features/settings/overlay-settings";

/** 小窓の見た目と、メインの×ボタンの動作。 */
export function OverlaySettingsCard(): JSX.Element {
  const opacity = useOverlaySettings((s) => s.overlay.opacity);
  const closeToTray = useOverlaySettings((s) => s.window.closeToTray);
  const updateOverlay = useOverlaySettings((s) => s.updateOverlay);
  const updateWindow = useOverlaySettings((s) => s.updateWindow);
  const storageError = useOverlaySettings((s) => s.storageError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>小窓</CardTitle>
        <CardDescription>
          ゲームの上に重ねて出す、常に最前面の小さなウィンドウ。位置と大きさは次に起動したときも残ります。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Alert>
          <MonitorIcon />
          <AlertTitle>ゲームは「ボーダーレス」で動かしてください</AlertTitle>
          <AlertDescription>
            Arma Reforger
            の表示モードを「ボーダーレス（ウィンドウ化フルスクリーン）」か「ウィンドウ」にしてください。「フルスクリーン」（排他的）では、小窓はゲームの上に出ません。
          </AlertDescription>
        </Alert>
        <div className="flex max-w-sm flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span id="overlay-opacity-label" className="font-medium">
              背景の不透明度
            </span>
            <span className="text-muted-foreground tabular-nums">{opacity}%</span>
          </div>
          <Slider
            aria-labelledby="overlay-opacity-label"
            min={OPACITY_MIN}
            max={OPACITY_MAX}
            step={5}
            value={[opacity]}
            onValueChange={(value) => {
              // Array.isArray は readonly の配列を any[] に絞ってしまうので、数かどうかで分ける
              const next = typeof value === "number" ? value : value[0];
              if (next !== undefined) {
                updateOverlay({ opacity: next });
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            下げると後ろのゲームが透けて見えます。文字は透けません。
          </p>
        </div>
        <label className="flex max-w-sm items-start justify-between gap-4 text-sm">
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">× で閉じたらタスクトレイに格納する</span>
            <span className="text-xs text-muted-foreground">
              オフにすると × でアプリを終了し、ホットキーも効かなくなります。
            </span>
          </span>
          <Switch
            checked={closeToTray}
            onCheckedChange={(checked) => {
              updateWindow({ closeToTray: checked });
            }}
          />
        </label>
        {storageError !== null && (
          <p role="alert" className="text-sm text-destructive">
            設定を保存できませんでした: {storageError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
