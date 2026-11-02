// 推移を、マニュアルのグラフの部品（ManualChart）のデータの形にする。
import type { DrugForecast } from "@/features/casualties/forecast";
import { DRUG_LABELS } from "@/features/casualties/labels";
import type { ChartData, ChartSpec } from "@/features/content/chart";
import { DRUG_IDS, type DrugId } from "@/features/medication/schema";

/** 効能の半分の線。1 本のピークを 100 とする */
const HALF_LINE = 50;

/** 薬ごとに key を固定し、線を出し入れしても同じ薬が同じ色・線の種類のままになるようにする */
function seriesKey(drug: DrugId): string {
  return `s${String(DRUG_IDS.indexOf(drug))}`;
}

/** 横軸の 0 の時刻（並べた薬の最初の投与）。 */
export function chartStartMs(forecasts: readonly DrugForecast[]): number {
  return Math.min(...forecasts.map((f) => f.firstAtMs));
}

export function forecastChartData(forecasts: readonly DrugForecast[]): ChartData {
  const startMs = chartStartMs(forecasts);
  const rows = new Map<number, Record<string, number>>();
  for (const forecast of forecasts) {
    const offset = Math.round((forecast.firstAtMs - startMs) / 1000);
    for (const point of forecast.points) {
      const x = point.seconds + offset;
      rows.set(x, { ...rows.get(x), [seriesKey(forecast.drug)]: point.percent });
    }
  }
  return {
    xLabel: "経過",
    xUnit: "s",
    series: forecasts.map((f) => ({
      key: seriesKey(f.drug),
      label: DRUG_LABELS[f.drug],
      panel: "y",
      unit: "%",
    })),
    points: [...rows.entries()].sort(([a], [b]) => a - b).map(([x, values]) => ({ x, values })),
  };
}

export function forecastChartSpec(forecasts: readonly DrugForecast[]): ChartSpec {
  return {
    x: "経過",
    y: forecasts.map((f) => DRUG_LABELS[f.drug]),
    y2: [],
    ref: [HALF_LINE],
    title: null,
    data: null,
    unit: "%",
  };
}
