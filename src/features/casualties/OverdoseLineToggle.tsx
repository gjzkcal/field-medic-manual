// 「N 本まで OK まで」を意識喪失と心停止のどちらで出すか。設定の画面と、負傷者のカードの上の帯の両方に置く。
import type { JSX } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OVERDOSE_LINES, type OverdoseLine } from "@/features/medication/overdose-line";
import { useViewerSettings } from "@/features/settings/viewer-settings";

const OVERDOSE_LINE_LABEL: Record<OverdoseLine, string> = {
  unconscious: "意識喪失",
  arrest: "心停止",
};

export function OverdoseLineToggle(): JSX.Element {
  const line = useViewerSettings((s) => s.settings.overdoseLine);
  const update = useViewerSettings((s) => s.update);
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      aria-label="危ない線"
      value={[line]}
      onValueChange={(values) => {
        // 選択中の項目を押すと空になるので、そのときは変えない
        const next = OVERDOSE_LINES.find((v) => v !== line && values.includes(v));
        if (next !== undefined) {
          update({ overdoseLine: next });
        }
      }}
    >
      {OVERDOSE_LINES.map((v) => (
        <ToggleGroupItem key={v} value={v}>
          {OVERDOSE_LINE_LABEL[v]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
