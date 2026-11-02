// 記録から、薬の先の推移とタイマーの時刻を計算する。記録が変わったときだけ計算し、画面は「時刻 − 今」で残り時間を出す。
// 裏のタブ、隠した小窓、閉じた後でもずれないのは、ここで絶対時刻だけを持つため。
import {
  doseConcentration,
  doseExpirySeconds,
  drugConfig,
  primaryEffect,
  singleDosePeak,
  type Concentrations,
} from "@/features/medication/pharmacology";
import { DRUG_IDS, type DrugId, type MedicationFile } from "@/features/medication/schema";

/** 1 本の投与。これから打つ仮の投与も同じ形で計算に渡せるよう、記録の型に依存しない */
export interface Dose {
  drug: DrugId;
  atMs: number;
}

export interface ForecastPoint {
  /** 最初の投与からの秒数 */
  seconds: number;
  /** 1 本のピークを 100 とした効能 */
  percent: number;
}

export interface DrugForecast {
  drug: DrugId;
  /** この薬の本数（体内に残っている分） */
  doseCount: number;
  firstAtMs: number;
  lastAtMs: number;
  /** 効能が極大になる時刻。次のピークを探す */
  peakTimesMs: readonly number[];
  /** 効能が最後に 50% を下回る時刻。50% に届かないなら null */
  halfAtMs: number | null;
  /** すべての投与が体内から取り除かれる時刻 */
  clearAtMs: number;
  points: readonly ForecastPoint[];
  /** 今の値の計算に使う投与（ナロキソンなど、効きに関わるほかの薬も含む） */
  doses: readonly Dose[];
}

/** グラフの点の間隔。ゲームの判定は 1 s ごとだが、線を描くには十分細かい */
const POINT_STEP_SECONDS = 5;
const MS = 1000;

/** 時刻 atMs の各薬の濃度の合計。 */
export function concentrationsAt(
  medication: MedicationFile,
  doses: readonly Dose[],
  atMs: number,
): Concentrations {
  const concentrations: Concentrations = {};
  for (const dose of doses) {
    const value = doseConcentration(drugConfig(medication, dose.drug), (atMs - dose.atMs) / MS);
    concentrations[dose.drug] = (concentrations[dose.drug] ?? 0) + value;
  }
  return concentrations;
}

/** 時刻 atMs の主な効能（符号付き）。 */
export function effectAt(
  medication: MedicationFile,
  drug: DrugId,
  doses: readonly Dose[],
  atMs: number,
): number {
  return primaryEffect(medication, drug, concentrationsAt(medication, doses, atMs));
}

function forecastDrug(
  medication: MedicationFile,
  drug: DrugId,
  doses: readonly Dose[],
): DrugForecast | null {
  const own = doses.filter((d) => d.drug === drug).map((d) => d.atMs);
  if (own.length === 0) {
    return null;
  }
  const firstAtMs = Math.min(...own);
  const lastAtMs = Math.max(...own);
  const clearAtMs = lastAtMs + doseExpirySeconds(drugConfig(medication, drug)) * MS;
  const peak = singleDosePeak(medication, drug);
  // ゲームは 1 s ごとに判定するので、時刻も 1 s 刻みで探す（グラフの点より細かく）
  const values: number[] = [];
  for (let ms = firstAtMs; ms <= clearAtMs; ms += MS) {
    values.push(Math.abs(effectAt(medication, drug, doses, ms)));
  }
  const peakTimesMs: number[] = [];
  let halfAtMs: number | null = null;
  values.forEach((value, i) => {
    const previous = values[i - 1];
    const next = values[i + 1];
    if (previous === undefined) {
      return;
    }
    if (next !== undefined && value > previous && value >= next) {
      peakTimesMs.push(firstAtMs + i * MS);
    }
    // ナロキソンを打つとモルヒネの効きは途中で下がってまた上がるので、最後に切る時刻を取る
    if (previous >= peak / 2 && value < peak / 2) {
      halfAtMs = firstAtMs + i * MS;
    }
  });
  const points = values.flatMap((value, i) =>
    i % POINT_STEP_SECONDS === 0 || i === values.length - 1
      ? [{ seconds: i, percent: (value / peak) * 100 }]
      : [],
  );
  return {
    drug,
    doseCount: own.length,
    firstAtMs,
    lastAtMs,
    peakTimesMs,
    halfAtMs,
    clearAtMs,
    points,
    doses,
  };
}

/**
 * 薬ごとの推移を作る。最後の投与の時点で消えていた投与を除くのは、前に看た記録が残っていても
 * 計算の範囲（最初の投与から消えるまで）が何時間にも伸びないようにするため。
 * 今の時刻を受けないので、同じ記録からは同じ結果になり、記録が変わったときだけ計算すれば足りる。
 */
export function buildForecasts(medication: MedicationFile, doses: readonly Dose[]): DrugForecast[] {
  const latestMs = Math.max(...doses.map((d) => d.atMs));
  const active = doses.filter(
    (d) => d.atMs + doseExpirySeconds(drugConfig(medication, d.drug)) * MS > latestMs,
  );
  return DRUG_IDS.flatMap((drug) => {
    const forecast = forecastDrug(medication, drug, active);
    return forecast === null ? [] : [forecast];
  });
}

/** カードのどのタイマーを大きく出すか。 */
export type TimerFocus = "peak" | "half" | "clear";

export interface DrugTimers {
  focus: TimerFocus;
  /** 次のピークの時刻。もうピークがなければ null */
  nextPeakAtMs: number | null;
  /** 半分を切る時刻。もう切ったか、50% に届かないなら null */
  halfAtMs: number | null;
  clearAtMs: number;
}

export function drugTimers(forecast: DrugForecast, nowMs: number): DrugTimers {
  const nextPeakAtMs = forecast.peakTimesMs.find((at) => at > nowMs) ?? null;
  const halfAtMs =
    forecast.halfAtMs !== null && forecast.halfAtMs > nowMs ? forecast.halfAtMs : null;
  const focus = nextPeakAtMs !== null ? "peak" : halfAtMs !== null ? "half" : "clear";
  return { focus, nextPeakAtMs, halfAtMs, clearAtMs: forecast.clearAtMs };
}
