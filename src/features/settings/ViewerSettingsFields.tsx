import type { JSX } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  FONT_SIZE_LABEL,
  FONT_SIZES,
  LINE_HEIGHT_LABEL,
  LINE_HEIGHTS,
  useViewerSettings,
} from "@/features/settings/viewer-settings";

/**
 * 文字サイズと行間の操作。変えるとすぐ本文に反映し、settings テーブルに保存する。
 * 設定画面とビューアの「表示」ボタンの両方で使う（読みながらでも変えられるように）。
 */
export function ViewerSettingsFields(): JSX.Element {
  const settings = useViewerSettings((s) => s.settings);
  const update = useViewerSettings((s) => s.update);
  const storageError = useViewerSettings((s) => s.storageError);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">文字サイズ</span>
        <ToggleGroup
          variant="outline"
          size="sm"
          aria-label="文字サイズ"
          value={[settings.fontSize]}
          onValueChange={(values) => {
            // 選択中の項目を押すと空になるので、そのときは変えない
            const next = FONT_SIZES.find((v) => values.includes(v));
            if (next !== undefined) {
              update({ fontSize: next });
            }
          }}
        >
          {FONT_SIZES.map((v) => (
            <ToggleGroupItem key={v} value={v} className="min-w-10">
              {FONT_SIZE_LABEL[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">行間</span>
        <ToggleGroup
          variant="outline"
          size="sm"
          aria-label="行間"
          value={[settings.lineHeight]}
          onValueChange={(values) => {
            const next = LINE_HEIGHTS.find((v) => values.includes(v));
            if (next !== undefined) {
              update({ lineHeight: next });
            }
          }}
        >
          {LINE_HEIGHTS.map((v) => (
            <ToggleGroupItem key={v} value={v}>
              {LINE_HEIGHT_LABEL[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {storageError !== null && (
        <p className="text-xs text-destructive">設定を保存できませんでした: {storageError}</p>
      )}
    </div>
  );
}
