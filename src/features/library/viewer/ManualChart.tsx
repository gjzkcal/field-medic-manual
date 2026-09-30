// 原稿の表から作った折れ線グラフ。Recharts を含むので、ビューアからは遅延読み込みで使う（起動を遅くしないため）。
import { useId, type JSX } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ChartData, ChartPanel, ChartSeries, ChartSpec } from "@/features/content/chart";

interface ManualChartProps {
  spec: ChartSpec;
  data: ChartData;
}

// 5 色を超える線は色が回り、同じ色の線ができる。原稿で 1 つのグラフに 5 本を超えて載せない前提
const COLOR_COUNT = 5;
// 点が多い（CSV の細かい推移）と点の印が重なって線が読めないので、線とマウスを載せたときの値だけにする
const MAX_DOTS = 30;

export function ManualChart({ spec, data }: ManualChartProps): JSX.Element {
  const syncId = useId();
  // 色は線ごとに通しで割り当てる。上下のグラフで同じ色が別の列を指さないようにするため
  const config: ChartConfig = Object.fromEntries(
    data.series.map((s, i) => [
      s.key,
      {
        label: s.unit === null ? s.label : `${s.label}（${s.unit}）`,
        color: `var(--chart-${String((i % COLOR_COUNT) + 1)})`,
      },
    ]),
  );
  const rows = data.points.map((p) => ({ x: p.x, ...p.values }));
  const showDots = data.points.length <= MAX_DOTS;
  const xs = data.points.map((p) => p.x);
  // 横軸が時間なら区切りのよい秒・分で目盛りを打つ。そうでなければ目盛りの位置は Recharts に任せる
  const xTicks =
    data.xUnit === "s"
      ? timeTicks(Math.min(...xs), Math.max(...xs))
      : { tickFormatter: (value: number) => formatValue(value, data.xUnit) };
  const panels: { panel: ChartPanel; refs: number[] }[] = [
    { panel: "y", refs: spec.ref },
    { panel: "y2", refs: [] },
  ];

  return (
    <>
      {spec.title !== null && (
        <figcaption className="mb-1 text-sm font-bold">{spec.title}</figcaption>
      )}
      {panels.map(({ panel, refs }) => {
        const series = data.series.filter((s) => s.panel === panel);
        if (series.length === 0) {
          return null;
        }
        return (
          <div key={panel} className="mb-2">
            <Legend series={series} config={config} />
            <ChartContainer config={config} className="aspect-auto h-44 w-full">
              <LineChart data={rows} syncId={syncId} margin={{ top: 8, right: 36, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  {...xTicks}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                />
                <YAxis width={40} tickLine={false} axisLine={false} tickMargin={4} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      // shadcn の部品は見出しに線の名前を渡すので、横軸の値は点のデータから取る
                      labelFormatter={(_, payload) => {
                        const x = xOf(payload[0]?.payload);
                        return x === null ? "" : `${data.xLabel} ${formatValue(x, data.xUnit)}`;
                      }}
                    />
                  }
                />
                {refs.map((value) => (
                  <ReferenceLine
                    key={value}
                    y={value}
                    ifOverflow="extendDomain"
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{
                      value: String(value),
                      position: "right",
                      fill: "var(--muted-foreground)",
                      fontSize: 11,
                    }}
                  />
                ))}
                {series.map((s) => (
                  <Line
                    key={s.key}
                    dataKey={s.key}
                    name={s.key}
                    type="linear"
                    stroke={`var(--color-${s.key})`}
                    strokeWidth={2}
                    dot={
                      showDots && {
                        r: 4,
                        strokeWidth: 2,
                        stroke: "var(--background)",
                        fill: `var(--color-${s.key})`,
                      }
                    }
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </div>
        );
      })}
    </>
  );
}

/** グラフの上に並べる線の名前。色だけで区別させないため、線が 1 本でも名前を出す（上下のどちらが何のグラフか分かるように） */
function Legend({ series, config }: { series: ChartSeries[]; config: ChartConfig }): JSX.Element {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="m-0 flex items-center gap-1.5">
          <span
            className="h-0.5 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: config[s.key]?.color }}
          />
          {config[s.key]?.label}
        </li>
      ))}
    </ul>
  );
}

// 目盛りの間隔の候補（秒）。区切りのよい秒と分だけにする
const TICK_STEPS = [5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];
const MAX_TICKS = 8;

/** 横軸（秒）の目盛り。1 分以上の間隔なら分で書く（原稿の表も長い時間は分で書くため）。 */
function timeTicks(
  min: number,
  max: number,
): { ticks: number[]; tickFormatter: (value: number) => string } {
  const range = Math.max(max - min, 1);
  const step = TICK_STEPS.find((s) => range / s <= MAX_TICKS) ?? Math.ceil(range / MAX_TICKS);
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    values.push(v);
  }
  const tickFormatter = (value: number): string =>
    step >= 60 ? `${String(value / 60)} 分` : formatValue(value, "s");
  return { ticks: values, tickFormatter };
}

/** ツールチップに渡る点のデータ（Recharts の型では any）から横軸の値を取り出す */
function xOf(point: unknown): number | null {
  return typeof point === "object" && point !== null && "x" in point && typeof point.x === "number"
    ? point.x
    : null;
}

function formatValue(value: number, unit: string | null): string {
  return unit === null ? String(value) : `${String(value)} ${unit}`;
}
