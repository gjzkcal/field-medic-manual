// 「N 本まで OK まで」を意識喪失と心停止のどちらで出すか。設定の画面と、負傷者のカードの上の帯の両方に置く。
import { useId, type JSX } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OVERDOSE_LINES, type OverdoseLine } from "@/features/medication/overdose-line";
import { useViewerSettings } from "@/features/settings/viewer-settings";

// 「意識喪失」「心停止」だけだと、隣の「痛み・気胸あり」と並んで、負傷者の今の状態を記録する欄に読める。
// カードの「N 本まで OK」と同じ語の見出しを付け、選択肢は避けたいことの形で書く
const OVERDOSE_LINE_HEADING = "OK の基準";
const OVERDOSE_LINE_LABEL: Record<OverdoseLine, string> = {
  unconscious: "意識喪失しない",
  arrest: "心停止しない",
};

export function OverdoseLineToggle(): JSX.Element {
  const line = useViewerSettings((s) => s.settings.overdoseLine);
  const update = useViewerSettings((s) => s.update);
  const headingId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span id={headingId} className="text-sm">
        {OVERDOSE_LINE_HEADING}
      </span>
      <ToggleGroup
        variant="outline"
        size="sm"
        aria-labelledby={headingId}
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
    </div>
  );
}
