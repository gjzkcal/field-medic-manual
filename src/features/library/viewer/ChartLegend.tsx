import type { JSX } from "react";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  dash: string | undefined;
}

/**
 * グラフの上に並べる線の名前。色だけで区別させないため、線が 1 本でも名前を出す（上下のどちらが何のグラフか分かるように）。
 * 見本は線と同じ色と線の種類で描く
 */
export function ChartLegend({ items }: { items: readonly LegendItem[] }): JSX.Element {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.key} className="m-0 flex items-center gap-1.5">
          <svg viewBox="0 0 24 4" className="h-1 w-6 shrink-0" aria-hidden>
            <line
              x1="0"
              y1="2"
              x2="24"
              y2="2"
              stroke={item.color}
              strokeWidth="2"
              strokeDasharray={item.dash}
            />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
