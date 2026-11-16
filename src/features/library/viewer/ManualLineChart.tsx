// 本文のグラフ（原稿の表や CSV から作った折れ線）。グラフのライブラリを使わず、SVG を直接書く。
// ライブラリ（Recharts）は 1 つ描くのに目盛りの文字を画面で測るなどの手間が大きく、グラフの多い原稿を開くと画面が固まった。
// 本文のグラフは線・格子・目盛り・基準の線・マウスを載せた点の値だけなので、自前で足りる。
import { memo, useMemo, useState, type JSX, type PointerEvent } from "react";

import type { ChartData, ChartPanel, ChartSpec } from "@/features/content/chart";
import { chartSummary } from "@/features/content/chart-summary";
import { ChartLegend, type LegendItem } from "@/features/library/viewer/ChartLegend";
import {
  dashOf,
  formatValue,
  innerTicks,
  linePath,
  MAX_DOTS,
  nearestIndex,
  seriesColor,
  seriesLabel,
  timeTicks,
  valueTicks,
} from "@/features/library/viewer/line-chart";

interface ManualLineChartProps {
  spec: ChartSpec;
  data: ChartData;
  /** すぐ後に同じ値の表があるか（読み上げの要約で、表へ案内する） */
  withTable: boolean;
}

// 線を描く領域の位置（px）。左は縦軸の数字、右は基準の線の数字、下は横軸の数字の場所
const LEFT = 40;
const RIGHT = 36;
const TOP = 8;
const PLOT_HEIGHT = 144;
// NOTE: SVG は、横だけを入れ物の幅に引き伸ばす（preserveAspectRatio="none"）。幅を測って描き直さずに済ませるため。
// viewBox の横は 0〜VIEW_WIDTH の仮の座標、縦は px と同じ。線の太さと破線は vector-effect で引き伸ばしの影響を外す。
// 文字は引き伸ばされると読めないので、SVG の外に HTML で置く
const VIEW_WIDTH = 1000;
/** 線を描く領域の横の位置（0〜1）を、入れ物の中の left にする */
function leftOf(t: number): string {
  return `calc(${String(LEFT)}px + (100% - ${String(LEFT + RIGHT)}px) * ${String(t)})`;
}

interface PanelSeries extends LegendItem {
  /** 点ごとの値（点の並びは横軸と同じ）。値が無ければ undefined */
  values: readonly (number | undefined)[];
}

interface Tick {
  value: number;
  label: string;
}

export function ManualLineChart({ spec, data, withTable }: ManualLineChartProps): JSX.Element {
  // マウスを載せている点。上下のグラフで同じ点を指す
  const [active, setActive] = useState<number | null>(null);

  const xs = useMemo(() => data.points.map((p) => p.x), [data]);
  const xTicks = useMemo((): Tick[] => {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    // 横軸が時間なら区切りのよい秒・分で目盛りを打つ
    if (data.xUnit === "s") {
      const { ticks, tickFormatter } = timeTicks(min, max);
      return ticks.map((value) => ({ value, label: tickFormatter(value) }));
    }
    return innerTicks(min, max).map((value) => ({ value, label: formatValue(value, data.xUnit) }));
  }, [xs, data.xUnit]);

  const panels = useMemo(() => {
    const order: { panel: ChartPanel; refs: readonly number[] }[] = [
      { panel: "y", refs: spec.ref },
      { panel: "y2", refs: [] },
    ];
    return order.flatMap(({ panel, refs }) => {
      const inPanel = data.series.filter((s) => s.panel === panel);
      if (inPanel.length === 0) {
        return [];
      }
      const series: PanelSeries[] = inPanel.map((s) => ({
        key: s.key,
        label: seriesLabel(s),
        color: seriesColor(s.key, data.series.indexOf(s), false),
        dash: dashOf(inPanel, s.key, false),
        values: data.points.map((p) => p.values[s.key]),
      }));
      return [{ panel, refs, series }];
    });
  }, [data, spec.ref]);

  // 図は読み上げから隠し、代わりに要約を図の説明にする（線の点を 1 つずつ読んでも形は分からないため）
  const summary = `グラフ: ${chartSummary(data)}${withTable ? "値は続く表にもあります。" : ""}`;
  const activeX = active === null ? undefined : xs[active];

  return (
    <>
      <figcaption className={spec.title === null ? "sr-only" : "mb-1 text-sm font-bold"}>
        {spec.title}
        <span className="sr-only">{summary}</span>
      </figcaption>
      <div aria-hidden>
        {panels.map(({ panel, refs, series }) => (
          <div key={panel} className="mb-2">
            <ChartLegend items={series} />
            <Panel
              xs={xs}
              xTicks={xTicks}
              series={series}
              refs={refs}
              active={active}
              activeLabel={
                activeX === undefined ? "" : `${data.xLabel} ${formatValue(activeX, data.xUnit)}`
              }
              onActive={setActive}
            />
          </div>
        ))}
      </div>
    </>
  );
}

interface PanelProps {
  xs: readonly number[];
  xTicks: readonly Tick[];
  series: readonly PanelSeries[];
  refs: readonly number[];
  active: number | null;
  activeLabel: string;
  onActive: (index: number | null) => void;
}

interface Scale {
  xMin: number;
  xRange: number;
  yTicks: readonly number[];
  yMin: number;
  yRange: number;
}

/** 点が 1 つだけのグラフでも、位置の計算で 0 で割らない */
function nonZero(range: number): number {
  return range === 0 ? 1 : range;
}

function scaleOf(xs: readonly number[], series: readonly PanelSeries[], refs: readonly number[]) {
  const values = series.flatMap((s) => s.values.filter((v) => v !== undefined));
  // 基準の線が値の範囲の外にあっても、見えるように軸を広げる
  const yTicks = valueTicks([...values, ...refs]);
  const xMin = Math.min(...xs);
  const yMin = yTicks[0] ?? 0;
  return {
    xMin,
    xRange: nonZero(Math.max(...xs) - xMin),
    yTicks,
    yMin,
    yRange: nonZero((yTicks.at(-1) ?? 1) - yMin),
  } satisfies Scale;
}

/** 横軸の値を、線を描く領域の中の位置（0〜1）にする */
function tOf(scale: Scale, x: number): number {
  return (x - scale.xMin) / scale.xRange;
}

/** 縦軸の値を、線を描く領域の上端からの px にする */
function yOf(scale: Scale, value: number): number {
  return PLOT_HEIGHT - ((value - scale.yMin) / scale.yRange) * PLOT_HEIGHT;
}

function Panel({
  xs,
  xTicks,
  series,
  refs,
  active,
  activeLabel,
  onActive,
}: PanelProps): JSX.Element {
  const scale = useMemo(() => scaleOf(xs, series, refs), [xs, series, refs]);

  function onPointer(event: PointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const t = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const index = nearestIndex(xs, scale.xMin + t * scale.xRange);
    onActive(index === -1 ? null : index);
  }

  const activeX = active === null ? undefined : xs[active];
  const activeT = activeX === undefined ? null : tOf(scale, activeX);

  return (
    <div className="relative h-44 w-full text-xs">
      {scale.yTicks.map((value) => (
        <span
          key={value}
          className="absolute -translate-y-1/2 text-muted-foreground tabular-nums"
          style={{ top: TOP + yOf(scale, value), right: `calc(100% - ${String(LEFT - 4)}px)` }}
        >
          {String(value)}
        </span>
      ))}
      {xTicks.map((tick) => (
        <span
          key={tick.value}
          className="absolute -translate-x-1/2 whitespace-nowrap text-muted-foreground tabular-nums"
          style={{ top: TOP + PLOT_HEIGHT + 6, left: leftOf(tOf(scale, tick.value)) }}
        >
          {tick.label}
        </span>
      ))}
      {refs.map((value) => (
        <span
          key={value}
          className="absolute -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
          style={{ top: TOP + yOf(scale, value), left: `calc(100% - ${String(RIGHT - 4)}px)` }}
        >
          {String(value)}
        </span>
      ))}
      <div
        className="absolute touch-pan-y"
        style={{ left: LEFT, right: RIGHT, top: TOP, height: PLOT_HEIGHT }}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => {
          onActive(null);
        }}
      >
        <Plot xs={xs} series={series} refs={refs} scale={scale} />
        {active !== null && activeT !== null && (
          <ActiveMarks series={series} scale={scale} index={active} t={activeT} />
        )}
      </div>
      {active !== null && activeT !== null && (
        <div
          className={`pointer-events-none absolute z-10 grid min-w-32 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 shadow-xl ${
            // 右半分では点の左に出す（右端で入れ物からはみ出さないように）
            activeT > 0.5 ? "-ml-3 -translate-x-full" : "ml-3"
          }`}
          style={{ top: TOP, left: leftOf(activeT) }}
        >
          <div className="font-medium">{activeLabel}</div>
          {series.map((s) => {
            const value = s.values[active];
            return value === undefined ? null : (
              <div key={s.key} className="flex items-center gap-2 leading-none">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: s.color }}
                />
                <span className="flex-1 text-muted-foreground">{s.label}</span>
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {value.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface PlotProps {
  xs: readonly number[];
  series: readonly PanelSeries[];
  refs: readonly number[];
  scale: Scale;
}

/**
 * 格子・基準の線・折れ線。マウスを動かすたびに描き直さないよう、マウスの位置に依らない部分だけを分けてある
 * （1000 点を超える線の path を、動かすたびに React が比べ直さないように）
 */
const Plot = memo(function Plot({ xs, series, refs, scale }: PlotProps): JSX.Element {
  const showDots = xs.length <= MAX_DOTS;
  return (
    <svg
      className="absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(PLOT_HEIGHT)}`}
      preserveAspectRatio="none"
      focusable="false"
    >
      {scale.yTicks.map((value) => (
        <line
          key={value}
          x1="0"
          x2={VIEW_WIDTH}
          y1={yOf(scale, value)}
          y2={yOf(scale, value)}
          className="stroke-border/50"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {refs.map((value) => (
        <line
          key={value}
          x1="0"
          x2={VIEW_WIDTH}
          y1={yOf(scale, value)}
          y2={yOf(scale, value)}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {series.map((s) => {
        const points = xs.map((x, i) => {
          const value = s.values[i];
          return {
            x: tOf(scale, x) * VIEW_WIDTH,
            y: value === undefined ? undefined : yOf(scale, value),
          };
        });
        return (
          <g key={s.key}>
            <path
              d={linePath(points)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeDasharray={s.dash}
              vectorEffect="non-scaling-stroke"
            />
            {showDots &&
              points.map((p, i) =>
                p.y === undefined ? null : (
                  <Dot key={xs[i]} x={p.x} y={p.y} color={s.color} size={8} />
                ),
              )}
          </g>
        );
      })}
    </svg>
  );
});

interface DotProps {
  x: number;
  y: number;
  color: string;
  /** 直径（px） */
  size: number;
}

/**
 * 点の印。背景の色の縁を付けて、線と重なっても見分けられるようにする。
 * NOTE: circle だと、横だけ引き伸ばした SVG の中で楕円になるので、長さ 0 の線を丸い端で描く。
 * 長さ 0 の線は、端の丸だけが線の太さの直径で描かれ、vector-effect で引き伸ばしの影響を受けない
 */
function Dot({ x, y, color, size }: DotProps): JSX.Element {
  const d = `M${String(x)} ${String(y)}h0`;
  return (
    <>
      <path
        d={d}
        stroke="var(--background)"
        strokeWidth={size + 4}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        stroke={color}
        strokeWidth={size}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

interface ActiveMarksProps {
  series: readonly PanelSeries[];
  scale: Scale;
  index: number;
  t: number;
}

/** マウスを載せている点の縦の線と、線ごとの点の印 */
function ActiveMarks({ series, scale, index, t }: ActiveMarksProps): JSX.Element {
  const x = t * VIEW_WIDTH;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(PLOT_HEIGHT)}`}
      preserveAspectRatio="none"
      focusable="false"
    >
      <line
        x1={x}
        x2={x}
        y1="0"
        y2={PLOT_HEIGHT}
        className="stroke-border"
        vectorEffect="non-scaling-stroke"
      />
      {series.map((s) => {
        const value = s.values[index];
        return value === undefined ? null : (
          <Dot key={s.key} x={x} y={yOf(scale, value)} color={s.color} size={10} />
        );
      })}
    </svg>
  );
}
