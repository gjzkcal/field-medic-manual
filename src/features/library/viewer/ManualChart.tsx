// 負傷者のカードの小さなグラフと大きなグラフ。Recharts を含むので、遅延読み込みで使う（起動を遅くしないため）。
// 過剰投与の線などを Recharts の部品で重ねて描くので、こちらは Recharts のままにしてある。
// 本文のグラフは ManualLineChart（自前の SVG）が描く。
import { useId, type JSX, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ChartData, ChartPanel, ChartSpec } from "@/features/content/chart";
import { chartSummary } from "@/features/content/chart-summary";
import { ChartLegend } from "@/features/library/viewer/ChartLegend";
import {
  dashOf,
  formatValue,
  MAX_DOTS,
  seriesColor,
  seriesLabel,
  timeTicks,
} from "@/features/library/viewer/line-chart";

interface ManualChartProps {
  spec: ChartSpec;
  data: ChartData;
  /** すぐ後に同じ値の表があるか（読み上げの要約で、表へ案内する） */
  withTable: boolean;
  /** 線の形だけを小さく描く。軸・凡例・説明を省くので、要約は呼び出し側が出す */
  compact?: boolean;
  /** 色と線の種類を、並びではなく系列の key（s0 なら 1 色目）で決める。線を出し入れしても別の線の色が変わらないように */
  stableColors?: boolean;
  /** グラフの中に重ねて描くもの（Recharts の部品） */
  children?: ReactNode;
}

export function ManualChart({
  spec,
  data,
  withTable,
  compact = false,
  stableColors = false,
  children,
}: ManualChartProps): JSX.Element {
  const syncId = useId();
  // 色は線ごとに通しで割り当てる。上下のグラフで同じ色が別の列を指さないようにするため
  const config: ChartConfig = Object.fromEntries(
    data.series.map((s, i) => [
      s.key,
      { label: seriesLabel(s), color: seriesColor(s.key, i, stableColors) },
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

  // 図の SVG は読み上げから隠し、代わりに要約を図の説明にする（線の点を 1 つずつ読んでも形は分からないため）
  const summary = `グラフ: ${chartSummary(data)}${withTable ? "値は続く表にもあります。" : ""}`;

  const plot = (
    <>
      {panels.map(({ panel, refs }) => {
        const series = data.series.filter((s) => s.panel === panel);
        if (series.length === 0) {
          return null;
        }
        return (
          <div key={panel} className={compact ? undefined : "mb-2"}>
            {!compact && (
              <ChartLegend
                items={series.map((s) => ({
                  key: s.key,
                  label: seriesLabel(s),
                  color: seriesColor(s.key, data.series.indexOf(s), stableColors),
                  dash: dashOf(series, s.key, stableColors),
                }))}
              />
            )}
            <ChartContainer
              config={config}
              className={compact ? "aspect-auto h-14 w-full" : "aspect-auto h-44 w-full"}
            >
              {/* キーボードで点をたどる層は、名前がなく値も読み上げられないので使わない（要約で伝える） */}
              <LineChart
                data={rows}
                syncId={syncId}
                margin={
                  compact
                    ? { top: 2, right: 2, bottom: 2, left: 2 }
                    : { top: 8, right: 36, left: 0 }
                }
                accessibilityLayer={false}
              >
                {!compact && <CartesianGrid vertical={false} />}
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  hide={compact}
                  {...xTicks}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                />
                <YAxis hide={compact} width={40} tickLine={false} axisLine={false} tickMargin={4} />
                {!compact && (
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
                )}
                {refs.map((value) => (
                  <ReferenceLine
                    key={value}
                    y={value}
                    ifOverflow="extendDomain"
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    {...(compact
                      ? {}
                      : {
                          label: {
                            value: String(value),
                            position: "right",
                            fill: "var(--muted-foreground)",
                            fontSize: 11,
                          },
                        })}
                  />
                ))}
                {series.map((s) => {
                  const dash = dashOf(series, s.key, stableColors);
                  return (
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
                      {...(dash === undefined ? {} : { strokeDasharray: dash })}
                    />
                  );
                })}
                {children}
              </LineChart>
            </ChartContainer>
          </div>
        );
      })}
    </>
  );

  if (compact) {
    return <div aria-hidden>{plot}</div>;
  }
  return (
    <>
      <figcaption className={spec.title === null ? "sr-only" : "mb-1 text-sm font-bold"}>
        {spec.title}
        <span className="sr-only">{summary}</span>
      </figcaption>
      <div aria-hidden>{plot}</div>
    </>
  );
}

/** ツールチップに渡る点のデータ（Recharts の型では any）から横軸の値を取り出す */
function xOf(point: unknown): number | null {
  return typeof point === "object" && point !== null && "x" in point && typeof point.x === "number"
    ? point.x
    : null;
}
