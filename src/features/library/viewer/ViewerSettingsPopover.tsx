import { TypeIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ViewerSettingsFields } from "@/features/settings/ViewerSettingsFields";

/** 読みながら文字サイズと行間を変えるためのボタン。中身は設定画面と同じ。 */
export function ViewerSettingsPopover(): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
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
