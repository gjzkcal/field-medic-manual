// グラフの読み上げ用の要約。負傷者のカードも使うので、形の検査（zod）を持つ chart.ts と分けてある
// （一緒にすると、グラフの無い画面の最初の JS に zod が入る）
import type { ChartData } from "@/features/content/chart";

/** 要約に出す値の桁。CSV の細かい値をそのまま読むと長くなるので、有効数字 4 桁に丸める */
const SUMMARY_PRECISION = 4;

function summaryNumber(value: number, unit: string | null): string {
  const rounded = String(Number(value.toPrecision(SUMMARY_PRECISION)));
  return unit === null ? rounded : `${rounded} ${unit}`;
}

/**
 * 読み上げ用のグラフの要約（WCAG 1.1.1）。線ごとに、始め・最大・最小・終わりの値と、その横軸の値を文にする。
 * 薬の濃度のように表のないグラフもあるので、線の形（いつ最大になり、いつ戻るか）が分かる点を選ぶ。
 * 始めか終わりと同じ点の最大・最小は繰り返さない
 */
export function chartSummary(data: ChartData): string {
  const at = (x: number): string => `${data.xLabel} ${summaryNumber(x, data.xUnit)}`;
  const lines = data.series.map((series) => {
    const label = series.unit === null ? series.label : `${series.label}（${series.unit}）`;
    const points = data.points.flatMap((p) => {
      const value = p.values[series.key];
      return value === undefined ? [] : [{ x: p.x, value }];
    });
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) {
      return `${label}: 値なし`;
    }
    let max = first;
    let min = first;
    for (const p of points) {
      if (p.value > max.value) {
        max = p;
      }
      if (p.value < min.value) {
        min = p;
      }
    }
    const value = (v: number): string => summaryNumber(v, series.unit);
    const parts = [`${at(first.x)} で ${value(first.value)}`];
    if (max !== first && max !== last) {
      parts.push(`最大 ${value(max.value)}（${at(max.x)}）`);
    }
    if (min !== first && min !== last) {
      parts.push(`最小 ${value(min.value)}（${at(min.x)}）`);
    }
    if (last !== first) {
      parts.push(`${at(last.x)} で ${value(last.value)}`);
    }
    return `${label}: ${parts.join("、")}`;
  });
  return `${lines.join("。")}。`;
}
