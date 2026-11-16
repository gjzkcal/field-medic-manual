// 折れ線グラフの、画面に依存しない計算（色と線の種類・目盛り・線の形・マウスに近い点）。
// 本文のグラフ（ManualLineChart）と、負傷者の画面のグラフ（ManualChart）の両方が使う。
import type { ChartSeries } from "@/features/content/chart";

// 5 色を超える線は色が回り、同じ色の線ができる。原稿で 1 つのグラフに 5 本を超えて載せない前提
const COLOR_COUNT = 5;
// 点が多い（CSV の細かい推移）と点の印が重なって線が読めないので、線とマウスを載せたときの値だけにする
export const MAX_DOTS = 30;
// 同じグラフの線は、色に加えて線の種類でも見分けられるようにする（色だけに頼らない。WCAG 1.4.1）
const DASHES = ["", "6 3", "2 3", "8 3 2 3", "12 4"];

/** key（s0, s1…）の番号。 */
function keyIndex(key: string): number {
  return Number(key.slice(1));
}

/**
 * 線の色。色は線ごとに通しで割り当てる（上下のグラフで同じ色が別の列を指さないようにするため）。
 * @param index グラフ全体の中での線の順番
 * @param stable 並びではなく key（s0 なら 1 色目）で決める。線を出し入れしても別の線の色が変わらないように
 */
export function seriesColor(key: string, index: number, stable: boolean): string {
  return `var(--chart-${String(((stable ? keyIndex(key) : index) % COLOR_COUNT) + 1)})`;
}

export function seriesLabel(series: ChartSeries): string {
  return series.unit === null ? series.label : `${series.label}（${series.unit}）`;
}

/** 同じグラフ（y / y2）の中での順番の線の種類。上下のグラフでは同じ種類が繰り返してよい（凡例はグラフごと） */
export function dashOf(
  series: readonly ChartSeries[],
  key: string,
  stable: boolean,
): string | undefined {
  const index = stable ? keyIndex(key) : series.findIndex((s) => s.key === key);
  const dash = DASHES[index % DASHES.length] ?? "";
  return dash === "" ? undefined : dash;
}

export function formatValue(value: number, unit: string | null): string {
  return unit === null ? String(value) : `${String(value)} ${unit}`;
}

// 目盛りの間隔の候補（秒）。区切りのよい秒と分だけにする
const TICK_STEPS = [5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];
const MAX_TICKS = 8;

/** 横軸（秒）の目盛り。1 分以上の間隔なら分で書く（原稿の表も長い時間は分で書くため）。 */
export function timeTicks(
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

/** 0.1 + 0.2 のような端数（0.30000000000000004）を、目盛りの数字に出さない */
function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

const NICE_FACTORS = [1, 2, 2.5, 4, 5, 6, 10];

/** range を count 個ほどに分ける、区切りのよい間隔（1・2・2.5・4・5・6 の 10 の累乗倍。6 は、心拍数のような 60 刻みが合う値のため） */
function niceStep(range: number, count: number): number {
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const factor = NICE_FACTORS.find((f) => f * power >= raw) ?? 10;
  return tidy(factor * power);
}

// 縦軸の区切りの数の目安
const Y_INTERVALS = 4;

/**
 * 縦軸の目盛り。最初と最後の目盛りが軸の両端になる（値をすべて含む、区切りのよい範囲）。
 * 値が正だけなら 0 から始める（途中から始めると、変化が実際より大きく見えるため）
 */
export function valueTicks(values: readonly number[]): number[] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (min === max) {
    return [0, 1];
  }
  const step = niceStep(max - min, Y_INTERVALS);
  const ticks: number[] = [];
  const last = Math.ceil(tidy(max / step));
  for (let i = Math.floor(tidy(min / step)); i <= last; i++) {
    ticks.push(tidy(i * step));
  }
  return ticks;
}

// 時間ではない横軸の区切りの数の目安
const X_INTERVALS = 5;

/** min〜max の中に収まる、区切りのよい目盛り（横軸は値の両端までしか描かないので、外にはみ出す目盛りは打たない） */
export function innerTicks(min: number, max: number): number[] {
  if (min >= max) {
    return [min];
  }
  const step = niceStep(max - min, X_INTERVALS);
  const ticks: number[] = [];
  const last = Math.floor(tidy(max / step));
  for (let i = Math.ceil(tidy(min / step)); i <= last; i++) {
    ticks.push(tidy(i * step));
  }
  return ticks;
}

/** SVG の座標は小数 2 桁まで（1000 点を超える線で、属性の文字列を短くする） */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * 折れ線の path の d。値の無い点は飛ばして前後をつなぐ（列ごとに空欄のある CSV でも線を切らない）。
 * @param points 画面の座標に直した点。値が無ければ y は undefined
 */
export function linePath(points: readonly { x: number; y: number | undefined }[]): string {
  let d = "";
  for (const { x, y } of points) {
    if (y !== undefined) {
      d += `${d === "" ? "M" : "L"}${coordinate(x)} ${coordinate(y)}`;
    }
  }
  return d;
}

/** 昇順の xs のうち、x に最も近いものの位置。xs が空なら -1 */
export function nearestIndex(xs: readonly number[], x: number): number {
  let low = 0;
  let high = xs.length - 1;
  if (high < 0) {
    return -1;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if ((xs[mid] ?? 0) <= x) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.abs((xs[low] ?? 0) - x) <= Math.abs((xs[high] ?? 0) - x) ? low : high;
}
