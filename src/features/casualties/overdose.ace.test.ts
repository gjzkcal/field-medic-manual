// 「N 本まで OK まで」の線の計算を、ACE の心拍数・血圧・状態の判定を 1 s ごとに進めた計算と突き合わせる。
// 線の計算は心拍数が目標に追いつくまでの遅れを無視しているので、時間をずらして打った場合にずれないかをここで確かめる。
// 式は ACE Medical Circulation（acemod/ACE-Anvil）を写したもの。血液 100%、出血なしの場合だけを扱う。
import { describe, expect, it } from "vitest";

import { overdoseLimit, safeAtMs } from "@/features/casualties/overdose";
import { loadMedication } from "@/features/medication/bundle";
import { doseConcentration, drugConfig, drugEffect } from "@/features/medication/pharmacology";
import type { OverdoseLine } from "@/features/medication/overdose-line";
import type { DrugId } from "@/features/medication/schema";

const medication = await loadMedication();

// ACE_Medical_Circulation_Settings.c の既定値
const DEFAULT_HEART_RATE = 80;
const DEFAULT_STROKE_VOLUME = 95;
const DEFAULT_RESISTANCE = 12.443 / (DEFAULT_HEART_RATE * DEFAULT_STROKE_VOLUME);

interface Thresholds {
  heartRateLow: number;
  heartRateHigh: number;
  pressureLow: number;
  pressureHigh: number;
  maxHeartRateForPressureLow: number;
}

// Configs/ACE/Settings.conf の m_CriticalThresholds と m_CardiacArrestThresholds
const CRITICAL: Thresholds = {
  heartRateLow: 30,
  heartRateHigh: 220,
  pressureLow: 5.21,
  pressureHigh: 29.5,
  maxHeartRateForPressureLow: 40,
};
const CARDIAC_ARREST: Thresholds = {
  heartRateLow: 20,
  heartRateHigh: 220,
  pressureLow: 5.21,
  pressureHigh: 29.5,
  maxHeartRateForPressureLow: 30,
};

/** 激痛の痛みの HP（原稿の「激痛」と同じ） */
const SEVERE_PAIN_HEALTH = 0.3;

/** SCR_CharacterDamageManagerComponent.c の ACE_Medical_GetPainIntensity（閾値 0.8・0.333） */
function painIntensity(painHealth: number, suppression: number): number {
  const health = painHealth + suppression;
  if (health > 0.8) {
    return 0;
  }
  if (health <= 0.333) {
    return 1;
  }
  return (health - 1) / (0.333 - 1);
}

/** ACE_Medical_VitalStateThresholdTransition.c（血液の段階は 100% なので当たらない） */
function hits(thresholds: Thresholds, heartRate: number, pressure: number): boolean {
  return (
    heartRate < thresholds.heartRateLow ||
    heartRate > thresholds.heartRateHigh ||
    (pressure < thresholds.pressureLow && heartRate <= thresholds.maxHeartRateForPressureLow) ||
    pressure > thresholds.pressureHigh
  );
}

interface Injection {
  atSeconds: number;
  count: number;
}

/**
 * 1 s ごとに進め、線に当たるか。心拍数は ACE_Medical_StableState.c のとおり目標へ 1 s で半分だけ近づき、
 * 平均血圧は ACE_Medical_IVitalState.c の 心拍数 × 1 回拍出量 × 血管抵抗。
 * 血液 100% では Unstable・Critical でも心拍数の計算は同じなので、状態は線に当たったかだけを見ればよい。
 */
function reachesLine(
  drug: DrugId,
  injections: readonly Injection[],
  painHealth: number,
  line: OverdoseLine,
  durationSeconds: number,
): boolean {
  const config = drugConfig(medication, drug);
  const thresholds = line === "arrest" ? CARDIAC_ARREST : CRITICAL;
  let heartRate = DEFAULT_HEART_RATE;
  for (let t = 1; t <= durationSeconds; t += 1) {
    // ゲームは打ってからの時間を整数の秒で数える（ACE_Medical_Dose.c）
    const concentration = injections.reduce(
      (sum, dose) => sum + dose.count * doseConcentration(config, t - dose.atSeconds),
      0,
    );
    const concentrations = { [drug]: concentration };
    const suppression = drugEffect(medication, "analgesia", drug, concentrations);
    const base = Math.max(
      DEFAULT_HEART_RATE,
      DEFAULT_HEART_RATE + 50 * painIntensity(painHealth, suppression),
    );
    const target = Math.max(0, base + drugEffect(medication, "heartRate", drug, concentrations));
    heartRate += (target - heartRate) * 0.5;
    const resistance =
      DEFAULT_RESISTANCE + drugEffect(medication, "vascularResistance", drug, concentrations);
    const pressure = heartRate * DEFAULT_STROKE_VOLUME * resistance;
    if (hits(thresholds, heartRate, pressure) || hits(CARDIAC_ARREST, heartRate, pressure)) {
      return true;
    }
  }
  return false;
}

const DRUGS_WITH_OVERDOSE = ["epinephrine", "metoprolol", "morphine", "phenylephrine"] as const;
const LINES = ["unconscious", "arrest"] as const;

/** 前の投与の後、N 本を打った分まで見るのに足りる長さ */
function durationAfter(drug: DrugId, startSeconds: number): number {
  return startSeconds + (drug === "morphine" ? 600 : 300);
}

describe("同時に打った場合: 原稿の本数が ACE の計算と同じ", () => {
  const cases = DRUGS_WITH_OVERDOSE.flatMap((drug) =>
    LINES.flatMap((line) => [false, true].map((severe) => ({ drug, line, severe }) as const)),
  );

  it.each(cases)("$drug $line 激痛 $severe", ({ drug, line, severe }) => {
    const counts = drugConfig(medication, drug).overdoseDoses?.[line];
    if (counts === undefined) {
      throw new Error(`本数がありません: ${drug}`);
    }
    const painHealth = severe ? SEVERE_PAIN_HEALTH : 1;
    let low = 0;
    let high = 20;
    for (let i = 0; i < 30; i += 1) {
      const middle = (low + high) / 2;
      if (reachesLine(drug, [{ atSeconds: 0, count: middle }], painHealth, line, 1200)) {
        high = middle;
      } else {
        low = middle;
      }
    }
    // 原稿は小数第 2 位までなので、四捨五入の幅だけ許す
    expect(Math.abs(high - (severe ? counts.severePain : counts.noPain))).toBeLessThanOrEqual(
      0.005,
    );
  });
});

describe("時間をずらして打った場合: 画面の時刻に N 本を打っても線に当たらない", () => {
  const priors = [[0], [0, 30], [0, 60], [0, 30, 60]] as const;
  const cases = DRUGS_WITH_OVERDOSE.flatMap((drug) =>
    LINES.flatMap((line) =>
      [false, true].flatMap((inPain) =>
        priors.map((prior) => ({ drug, line, inPain, prior: prior.join(",") }) as const),
      ),
    ),
  );

  it.each(cases)(
    "$drug $line 痛み・気胸 $inPain 前の投与 $prior s",
    ({ drug, line, inPain, prior }) => {
      const limit = overdoseLimit(medication, drug, line, inPain);
      if (limit.kind !== "limit") {
        // 激痛のフェニレフリンは「1 本でも危険」なので、時刻を出さない
        expect(drug === "phenylephrine" && inPain).toBe(true);
        return;
      }
      const priorSeconds = prior.split(",").map(Number);
      const lastSeconds = Math.max(...priorSeconds);
      const shownSeconds =
        safeAtMs(
          medication,
          drug,
          priorSeconds.map((s) => s * 1000),
          limit,
        ) / 1000;
      const injections = (startSeconds: number): Injection[] => [
        ...priorSeconds.map((atSeconds) => ({ atSeconds, count: 1 })),
        { atSeconds: startSeconds, count: limit.doses },
      ];
      // 痛み・気胸ありは、痛みがあってもなくても大丈夫であること
      const painLevels = inPain ? [1, SEVERE_PAIN_HEALTH] : [1];
      for (const painHealth of painLevels) {
        expect(
          reachesLine(
            drug,
            injections(shownSeconds),
            painHealth,
            line,
            durationAfter(drug, shownSeconds),
          ),
        ).toBe(false);
      }
      // 長めにしすぎていないこと。線の本数を決めた痛みの強さで、ACE の計算の最初の安全な時刻と比べる
      const painHealth =
        drugConfig(medication, drug).overdoseDoses?.[line].noPain === limit.threshold
          ? 1
          : SEVERE_PAIN_HEALTH;
      let low = lastSeconds;
      let high = Math.ceil(shownSeconds);
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (reachesLine(drug, injections(middle), painHealth, line, durationAfter(drug, middle))) {
          low = middle;
        } else {
          high = middle;
        }
      }
      expect(shownSeconds).toBeGreaterThanOrEqual(high);
      expect(shownSeconds - high).toBeLessThanOrEqual(60);
    },
  );
});
