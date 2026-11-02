// 負傷者のグラフの本体。Recharts を含むので、呼び出し側は遅延読み込みで使う（起動を遅くしないため）。
import type { JSX } from "react";
import { usePlotArea, useXAxisScale } from "recharts";

import { useClock } from "@/features/casualties/clock";
import type { ChartData, ChartSpec } from "@/features/content/chart";
import { ManualChart } from "@/features/library/viewer/ManualChart";

/**
 * 「今」の縦線。1 s ごとに動くので、この部品だけが時計を購読し、グラフの線は描き直さない。
 * グラフの範囲の外（まだ体内にあるのに表の外へ出た場合など）では描かない。
 */
function NowLine({ startMs }: { startMs: number }): JSX.Element | null {
  const now = useClock();
  const scale = useXAxisScale();
  const area = usePlotArea();
  const x = scale?.((now - startMs) / 1000);
  if (x === undefined || area === undefined || x < area.x || x > area.x + area.width) {
    return null;
  }
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={area.y}
        y2={area.y + area.height}
        stroke="var(--foreground)"
        strokeWidth={1}
      />
      <text x={x + 4} y={area.y + 10} fill="var(--foreground)" fontSize={11}>
        今
      </text>
    </g>
  );
}

interface CasualtyChartBodyProps {
  spec: ChartSpec;
  data: ChartData;
  compact: boolean;
  /** 横軸の 0 の時刻。大きなグラフの「今」の線に使う */
  startMs: number | null;
}

export function CasualtyChartBody({
  spec,
  data,
  compact,
  startMs,
}: CasualtyChartBodyProps): JSX.Element {
  return (
    <ManualChart spec={spec} data={data} withTable={false} compact={compact} stableColors>
      {startMs !== null && <NowLine startMs={startMs} />}
    </ManualChart>
  );
}
