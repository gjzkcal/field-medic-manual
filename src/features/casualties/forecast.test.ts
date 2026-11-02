import { describe, expect, it } from "vitest";

import {
  buildForecasts,
  concentrationsAt,
  drugTimers,
  effectAt,
  type Dose,
  type DrugForecast,
} from "@/features/casualties/forecast";
import { loadMedication } from "@/features/medication/bundle";
import type { DrugId } from "@/features/medication/schema";

const medication = await loadMedication();
const T0 = 1_793_000_000_000;
const S = 1000;

function forecastOf(doses: readonly Dose[], drug: DrugId): DrugForecast {
  const forecast = buildForecasts(medication, doses).find((f) => f.drug === drug);
  if (forecast === undefined) {
    throw new Error(`推移がありません: ${drug}`);
  }
  return forecast;
}

describe("buildForecasts", () => {
  it("1 本なら、効能の半分と消える時刻が 1 本の値になる", () => {
    const forecast = forecastOf([{ drug: "epinephrine", atMs: T0 }], "epinephrine");
    expect(forecast.doseCount).toBe(1);
    expect(forecast.clearAtMs).toBe(T0 + 164 * S);
    // 心拍数の補正は濃度に比例するので、濃度の半分の時刻（63.7 s）の次の秒になる
    expect(forecast.halfAtMs).toBe(T0 + 64 * S);
    expect(forecast.peakTimesMs).toEqual([T0 + 23 * S]);
  });

  it("効能の半分は濃度の半分と違う", () => {
    expect(forecastOf([{ drug: "naloxone", atMs: T0 }], "naloxone").halfAtMs).toBe(T0 + 950 * S);
    expect(forecastOf([{ drug: "phenylephrine", atMs: T0 }], "phenylephrine").halfAtMs).toBe(
      T0 + 102 * S,
    );
  });

  it("2 本なら効能を足し合わせ、消えるのは後の 1 本に合わせる", () => {
    const earlier: Dose = { drug: "epinephrine", atMs: T0 };
    const later: Dose = { drug: "epinephrine", atMs: T0 + 30 * S };
    const doses = [earlier, later];
    const forecast = forecastOf(doses, "epinephrine");
    expect(forecast.doseCount).toBe(2);
    expect(forecast.clearAtMs).toBe(T0 + 194 * S);
    const value = effectAt(medication, "epinephrine", doses, T0 + 40 * S);
    const first = effectAt(medication, "epinephrine", [earlier], T0 + 40 * S);
    const second = effectAt(medication, "epinephrine", [later], T0 + 40 * S);
    expect(value).toBeCloseTo(first + second, 8);
  });

  it("ナロキソンを打つとモルヒネの効能が下がり、半分は最後に切る時刻になる", () => {
    const morphine: Dose = { drug: "morphine", atMs: T0 };
    const naloxone: Dose = { drug: "naloxone", atMs: T0 };
    const alone = forecastOf([morphine], "morphine");
    const blocked = forecastOf([morphine, naloxone], "morphine");
    expect(effectAt(medication, "morphine", [morphine, naloxone], T0 + 120 * S)).toBeLessThan(
      effectAt(medication, "morphine", [morphine], T0 + 120 * S),
    );
    // ナロキソンは先に抜けるので、モルヒネの効きは途中で上がり直す
    expect(blocked.peakTimesMs.length).toBeGreaterThanOrEqual(1);
    expect((blocked.halfAtMs ?? 0) < (alone.halfAtMs ?? 0) || blocked.halfAtMs === null).toBe(true);
    expect(blocked.clearAtMs).toBe(alone.clearAtMs);
  });

  it("ナロキソンの濃度が抜けた後の効きの戻りも推移に入る", () => {
    const doses: Dose[] = [
      { drug: "morphine", atMs: T0 },
      { drug: "naloxone", atMs: T0 },
    ];
    const atSeven = effectAt(medication, "morphine", doses, T0 + 120 * S);
    const atFifteen = effectAt(medication, "morphine", doses, T0 + 900 * S);
    expect(atFifteen).toBeGreaterThan(atSeven);
  });

  it("点は 5 s ごとで、最後の点は 0 になる", () => {
    const forecast = forecastOf([{ drug: "epinephrine", atMs: T0 }], "epinephrine");
    expect(forecast.points[1]?.seconds).toBe(5);
    expect(forecast.points.at(-1)?.seconds).toBe(164);
    expect(forecast.points.at(-1)?.percent).toBe(0);
    const peak = Math.max(...forecast.points.map((p) => p.percent));
    expect(peak).toBeGreaterThan(95);
    expect(peak).toBeLessThanOrEqual(100);
  });

  it("最後の投与の時点で消えていた投与は、計算の範囲に入れない", () => {
    const old: Dose = { drug: "morphine", atMs: T0 };
    const fresh: Dose = { drug: "epinephrine", atMs: T0 + 10_000 * S };
    const forecasts = buildForecasts(medication, [old, fresh]);
    expect(forecasts.map((f) => f.drug)).toEqual(["epinephrine"]);
  });

  it("同じ記録からは同じ結果になる（描き直しで計算し直さなくてよい）", () => {
    const doses: Dose[] = [{ drug: "morphine", atMs: T0 }];
    expect(buildForecasts(medication, doses)).toEqual(buildForecasts(medication, doses));
  });
});

describe("drugTimers", () => {
  const forecast = forecastOf([{ drug: "epinephrine", atMs: T0 }], "epinephrine");

  it("上がっている間はピークまでを大きく出す", () => {
    const timers = drugTimers(forecast, T0 + 5 * S);
    expect(timers.focus).toBe("peak");
    expect(timers.nextPeakAtMs).toBe(T0 + 23 * S);
    expect(timers.halfAtMs).toBe(T0 + 64 * S);
  });

  it("下がり始めたら半分までを大きく出す", () => {
    const timers = drugTimers(forecast, T0 + 30 * S);
    expect(timers.focus).toBe("half");
    expect(timers.nextPeakAtMs).toBeNull();
  });

  it("半分を切ったら消えるまでを大きく出す", () => {
    const timers = drugTimers(forecast, T0 + 70 * S);
    expect(timers.focus).toBe("clear");
    expect(timers.halfAtMs).toBeNull();
    expect(timers.clearAtMs).toBe(T0 + 164 * S);
  });

  it("時刻で持つので、裏に回っていて間が空いても残り時間がずれない", () => {
    // 記録の後すぐの計算でも、ずっと後の計算でも、同じ時刻を指す
    const later = drugTimers(forecast, T0 + 100 * S);
    expect(later.clearAtMs - (T0 + 100 * S)).toBe(64 * S);
  });
});

describe("concentrationsAt", () => {
  it("体内に残っている薬だけを足す", () => {
    const doses: Dose[] = [{ drug: "epinephrine", atMs: T0 }];
    expect(concentrationsAt(medication, doses, T0 + 200 * S).epinephrine).toBe(0);
    expect(concentrationsAt(medication, doses, T0 + 10 * S).morphine).toBeUndefined();
  });
});
