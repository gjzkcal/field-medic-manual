// 投与から、心拍数と血圧の推移を計算する。ACE Medical Circulation（acemod/ACE-Anvil）の式を写したもの。
// ゲームは 1 s ごとに、心拍数を目標へ近づけてから血圧と状態を決める。心拍数が前の値に依存するので、
// 濃度のように時刻から直接は出せず、始めから 1 s ずつ進める。
// 血液量と痛みの HP は計算の間ずっと一定として扱う（出血や自然回復で変わっていく分は入れていない）。
import { concentrationsAt, type Dose } from "@/features/casualties/forecast";
import { totalEffect } from "@/features/medication/pharmacology";
import type { MedicationFile } from "@/features/medication/schema";

// ACE_Medical_Circulation_Settings.c の既定値（Settings.conf に上書きなし）
const DEFAULT_HEART_RATE = 80;
const DEFAULT_STROKE_VOLUME = 95;
const DEFAULT_MEAN_PRESSURE_KPA = 12.443;
const DEFAULT_PULSE_PRESSURE_KPA = 5.3329;
const DEFAULT_RESISTANCE = DEFAULT_MEAN_PRESSURE_KPA / (DEFAULT_HEART_RATE * DEFAULT_STROKE_VOLUME);
const PULSE_PRESSURE_SCALE = DEFAULT_PULSE_PRESSURE_KPA / DEFAULT_MEAN_PRESSURE_KPA;
/** ACE_PhysicalConstants.c */
const KPA_TO_MMHG = 7.5006168;
/** ACE_Medical_StableState.c: 1 s で、目標までの残りのこの割合だけ近づく */
const HEART_RATE_PROGRESS_PER_SECOND = 0.5;
/** ACE_Medical_StableState.c: 痛みの強さ 1 で、目標の心拍数に足す分 */
const PAIN_HEART_RATE = 50;
// 痛みの HP の段階の閾値（Core の DamageManager_Character_Base.ct の MODERATE・SERIOUS）
const PAIN_NONE_ABOVE = 0.8;
const PAIN_FULL_AT_OR_BELOW = 0.333;
/** 血液の段階の閾値（Circulation の DamageManager_Character_Base.ct。Class II・III・IV） */
const BLOOD_CLASS = { two: 0.7, three: 0.4, four: 0.2 } as const;
const MS = 1000;

/**
 * 薬を打つ前に、患者の状態だけで進めておく秒数。心拍数が落ち着いた値から線を始めるため
 * （激痛の患者は、打つ前から心拍数が上がっている。既定の 80 から始めると、実際にはない立ち上がりが線の頭に出る）。
 * 1 s で残りの半分ずつ近づくので、60 s あれば差は表示の桁より十分小さくなる
 */
const SETTLE_SECONDS = 60;

interface Thresholds {
  heartRateLow: number;
  heartRateHigh: number;
  pressureLowKpa: number;
  pressureHighKpa: number;
  maxHeartRateForPressureLow: number;
  blood: number;
}

// Configs/ACE/Settings.conf の m_UnstableThresholds・m_CriticalThresholds・m_CardiacArrestThresholds
const UNSTABLE: Thresholds = {
  heartRateLow: 40,
  heartRateHigh: 220,
  pressureLowKpa: 7.11,
  pressureHighKpa: 29.5,
  maxHeartRateForPressureLow: 80,
  blood: BLOOD_CLASS.two,
};
const CRITICAL: Thresholds = {
  heartRateLow: 30,
  heartRateHigh: 220,
  pressureLowKpa: 5.21,
  pressureHighKpa: 29.5,
  maxHeartRateForPressureLow: 40,
  blood: BLOOD_CLASS.three,
};
const CARDIAC_ARREST: Thresholds = {
  heartRateLow: 20,
  heartRateHigh: 220,
  pressureLowKpa: 5.21,
  pressureHighKpa: 29.5,
  maxHeartRateForPressureLow: 30,
  blood: BLOOD_CLASS.four,
};

type VitalState = "stable" | "unstable" | "critical" | "arrest";

/** 患者の状態。どちらも 0〜1 の割合 */
export interface PatientState {
  /** 血液量（血液の HP の割合） */
  blood: number;
  /** 痛みの HP の割合。1 で痛みなし、低いほど痛い */
  painHealth: number;
}

export const HEALTHY_PATIENT: PatientState = { blood: 1, painHealth: 1 };

export interface VitalsPoint {
  seconds: number;
  heartRate: number;
  meanPressureKpa: number;
}

export interface VitalsTimeline {
  /** 0 s から 1 s ごと。心停止に当たったら、その時刻の点で終わる */
  points: readonly VitalsPoint[];
  /**
   * 0 s 以降で、意識を失う状態（Critical）に最初に入った時刻。0 s の時点でその状態なら 0。入らなければ null。
   * 0 s より前に入って抜けた分は数えない（抜けた後に、いつ意識が戻るかはここでは計算していない）
   */
  unconsciousAtSeconds: number | null;
  /** 心停止に入った時刻。0 s より前なら負の値（計算の始まりより前には、さかのぼらない）。入らなければ null */
  arrestAtSeconds: number | null;
}

export interface VitalsInput {
  medication: MedicationFile;
  doses: readonly Dose[];
  patient: PatientState;
  /** 計算する長さ（横軸の 0 = atMs の 0 からの秒数） */
  endSeconds: number;
  /**
   * 計算を始める時刻（0 以下の整数の秒）。0 s より前に打った投与があるときに、その投与から進めるために渡す
   * （心拍数と状態は前の値に依存するので、途中から始めると、前の投与の分が抜ける）。点は 0 s 以降だけを返す
   */
  startSeconds?: number;
  /** 薬を打つ前に進めておく秒数。原稿の表（既定の心拍数から始めた値）と突き合わせるときだけ 0 にする */
  settleSeconds?: number;
}

/** SCR_CharacterDamageManagerComponent.c（Core）の ACE_Medical_GetPainIntensity */
function painIntensity(painHealth: number, suppression: number): number {
  const health = painHealth + suppression;
  if (health > PAIN_NONE_ABOVE) {
    return 0;
  }
  if (health <= PAIN_FULL_AT_OR_BELOW) {
    return 1;
  }
  return (health - 1) / (PAIN_FULL_AT_OR_BELOW - 1);
}

/** ACE_Medical_VitalStateThresholdTransition.c */
function hits(
  thresholds: Thresholds,
  heartRate: number,
  pressureKpa: number,
  blood: number,
): boolean {
  return (
    heartRate < thresholds.heartRateLow ||
    heartRate > thresholds.heartRateHigh ||
    (pressureKpa < thresholds.pressureLowKpa &&
      heartRate <= thresholds.maxHeartRateForPressureLow) ||
    pressureKpa > thresholds.pressureHighKpa ||
    blood <= thresholds.blood
  );
}

/**
 * 次の状態。ACE_Medical_VitalStatesSystem.c の登録順に見て、最初に当たった遷移だけを行う
 * （心停止 → Critical → Unstable の順。戻るのは 1 回の更新で 1 段ずつ）。
 */
function nextState(
  state: VitalState,
  heartRate: number,
  pressureKpa: number,
  blood: number,
): VitalState {
  const hit = (thresholds: Thresholds): boolean => hits(thresholds, heartRate, pressureKpa, blood);
  if (hit(CARDIAC_ARREST)) {
    return "arrest";
  }
  if (state === "critical") {
    return hit(CRITICAL) ? "critical" : "unstable";
  }
  if (hit(CRITICAL)) {
    return "critical";
  }
  return hit(UNSTABLE) ? "unstable" : "stable";
}

/** 平均血圧（kPa）から、収縮期と拡張期（mmHg）。ACE_Medical_VitalsComponent.c の GetBloodPressures */
export function bloodPressureMmhg(meanPressureKpa: number): {
  systolic: number;
  diastolic: number;
} {
  const pulse = PULSE_PRESSURE_SCALE * meanPressureKpa;
  return {
    systolic: (meanPressureKpa + (2 / 3) * pulse) * KPA_TO_MMHG,
    diastolic: (meanPressureKpa - (1 / 3) * pulse) * KPA_TO_MMHG,
  };
}

export function kpaToMmhg(kpa: number): number {
  return kpa * KPA_TO_MMHG;
}

/** 投与と患者の状態から、心拍数と平均血圧を 1 s ごとに進める。 */
export function simulateVitals(input: VitalsInput): VitalsTimeline {
  const { medication, doses, patient, endSeconds } = input;
  const settleSeconds = input.settleSeconds ?? SETTLE_SECONDS;
  let state: VitalState = "stable";
  let heartRate = DEFAULT_HEART_RATE;
  let pressureKpa = DEFAULT_HEART_RATE * DEFAULT_STROKE_VOLUME * patient.blood * DEFAULT_RESISTANCE;
  let unconsciousAtSeconds: number | null = null;
  let arrestAtSeconds: number | null = null;
  const points: VitalsPoint[] = [];

  const startSeconds = input.startSeconds ?? 0;
  const firstSeconds = startSeconds - settleSeconds;
  for (let seconds = firstSeconds; seconds <= endSeconds; seconds += 1) {
    // 始めの点（進める前の値）は、更新せずにそのまま出す
    if (seconds > firstSeconds) {
      const concentrations = concentrationsAt(medication, doses, seconds * MS);
      // ACE_Medical_CriticalState.c: 出血性ショックの頻脈。前の更新の心拍数と平均血圧から決まる
      const base =
        state === "critical" && patient.blood < BLOOD_CLASS.three
          ? (heartRate * 14.3 * (0.5 + 0.5 * patient.blood)) / Math.max(6, pressureKpa)
          : DEFAULT_HEART_RATE;
      const pain = painIntensity(
        patient.painHealth,
        totalEffect(medication, "analgesia", concentrations),
      );
      // ACE_Medical_StableState.c の ComputeTargetHeartRate
      const target = Math.max(
        0,
        Math.max(base, DEFAULT_HEART_RATE + PAIN_HEART_RATE * pain) +
          totalEffect(medication, "heartRate", concentrations),
      );
      heartRate += (target - heartRate) * HEART_RATE_PROGRESS_PER_SECOND;
      // ACE_Medical_IVitalState.c: 心拍出量 × 血管抵抗
      pressureKpa =
        heartRate *
        DEFAULT_STROKE_VOLUME *
        patient.blood *
        (DEFAULT_RESISTANCE + totalEffect(medication, "vascularResistance", concentrations));
      state = nextState(state, heartRate, pressureKpa, patient.blood);
    }
    if (state === "arrest") {
      arrestAtSeconds = Math.max(seconds, startSeconds);
      unconsciousAtSeconds ??= Math.max(arrestAtSeconds, 0);
    } else if (state === "critical" && seconds >= 0) {
      unconsciousAtSeconds ??= seconds;
    }
    if (seconds >= 0) {
      points.push({ seconds, heartRate, meanPressureKpa: pressureKpa });
    }
    // 心停止の後は、心拍数も血圧も 0 のまま（ACE_Medical_CardiacArrestState.c）。蘇生は扱わないので、ここで終える
    if (state === "arrest") {
      break;
    }
  }
  return { points, unconsciousAtSeconds, arrestAtSeconds };
}
