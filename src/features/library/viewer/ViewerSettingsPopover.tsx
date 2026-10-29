import { TypeIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ViewerSettingsFields } from "@/features/settings/ViewerSettingsFields";

/** 読みながらテーマ・文字サイズ・行間を変えるためのボタン。中身は設定画面と同じ。 */
export function ViewerSettingsPopover(): JSX.Element {
  return (
    <Popover>
      {/* 見える文字は短く「表示」のまま、何を開くかを名前で補う（名前は見える文字から始める） */}
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label="表示の設定" />}>
        <TypeIcon />
        表示
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto">
        <PopoverTitle>表示の設定</PopoverTitle>
        <ViewerSettingsFields />
      </PopoverContent>
    </Popover>
  );
}
