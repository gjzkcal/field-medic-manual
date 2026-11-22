// 投与と患者の状態から、心拍数・血圧・SpO2 の推移を計算する。
// ACE Medical の Circulation と Breathing（acemod/ACE-Anvil）の式を写したもの。
// ゲームは 1 s ごとに、心拍数を目標へ近づけてから血圧を決め、続けて呼吸・肺・血液の酸素を進め、最後に状態を決める。
// どれも前の値に依存するので、濃度のように時刻から直接は出せず、始めから 1 s ずつ進める。
// 患者の状態（血液量・痛み・気道・気胸など）は、渡された値と、渡された時刻の変更だけで決まる
// （出血や自然回復、気胸の悪化のように、ゲームの中で進んでいく分は入れていない）。
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
/** ACE_PhysicalConstants.c の気体定数と、Circulation の ACE_Medical_VitalsComponent.c の体温（K） */
const GAS_CONSTANT_TIMES_TEMPERATURE = 8.3144626 * 310.15;
/** ACE_Medical_StableState.c: 1 s で、目標までの残りのこの割合だけ近づく */
const HEART_RATE_PROGRESS_PER_SECOND = 0.5;
/** ACE_Medical_StableState.c: 痛みの強さ 1 で、目標の心拍数に足す分 */
const PAIN_HEART_RATE = 50;
// 痛みの HP の段階の閾値（Core の DamageManager_Character_Base.ct の MODERATE・SERIOUS）
const PAIN_NONE_ABOVE = 0.8;
const PAIN_FULL_AT_OR_BELOW = 0.333;
/** 血液の段階の閾値（Circulation の DamageManager_Character_Base.ct。Class II・III・IV） */
const BLOOD_CLASS = { two: 0.7, three: 0.4, four: 0.2 } as const;
/** 血液の HP の最大（Circulation の DamageManager_Character_Base.ct） */
const BLOOD_MAX_HEALTH = 3000;
const MS = 1000;

// Breathing の既定値（ACE_Medical_Breathing_Settings.c と、Breathing の ACE_Medical_VitalsComponent.c の Reset）
const DEFAULT_RESPIRATORY_RATE = 14.573;
const MAX_RESPIRATORY_RATE = 40;
const DEFAULT_SPO2 = 97.149;
const HYPOXIC_SPO2 = 75;
const DEFAULT_ALVEOLAR_O2_KPA = 13.3;
const DEFAULT_ALVEOLAR_CO2_KPA = 5.21;
const DEFAULT_VENOUS_CO2 = 0.001_236_037_138_574_214_5;
/** 酸素の消費（mmol/s）。SpO2 が既定のときと、低酸素のとき */
const OXYGEN_CONSUMPTION = { normal: 0.208, hypoxic: 0.013 } as const;
/** 消費した酸素に対する、作る CO2 の割合。SpO2 が既定のときと、低酸素のとき */
const EXCHANGE_RATIO = { normal: 0.8, hypoxic: 1.2 } as const;
/** 緊張性気胸のとき、1 回拍出量に掛ける倍率 */
const TENSION_STROKE_VOLUME_SCALE = 0.455;
/** ACE_Medical_StableState.c（Breathing）: 既定を超えた呼吸数 1 回/分ごとに、目標の心拍数に足す分 */
const TACHYPNEA_HEART_RATE = 2;
// Breathing の ACE_Medical_VitalsComponent.c の定数
const TIDAL_VOLUME_ML = (500 * 2) / 3;
const LUNG_CAPACITY_ML = (6000 * 2) / 3;
const ALVEOLAR_O2_MAX_KPA = 19.925;
const ALVEOLAR_O2_MAX_WITH_MASK_KPA = 95;
/** 酸素マスクを付けているときの、換気の速さの下限 */
const MASK_MIN_VENTILATION = 0.015;
const BLOOD_BICARBONATE = 0.024;
const CARBONATE_RATE_SCALE = 126.933_85;
// ACE_MaterialProperties.c
const HEMOGLOBIN_KD_KPA = 3.6;
const HEMOGLOBIN_HILL = 2.7;
const CO2_SOLUBILITY = 0.000_225;
/** SCR_CharacterBloodHitZone.c（Breathing）: ヘムの濃度（mmol/ml）と、動脈・静脈の血液の割合 */
const HEME_CONCENTRATION = 0.0098;
const ARTERIAL_BLOOD_SHARE = 0.3;
const VENOUS_BLOOD_SHARE = 0.7;
/** 灌流がこれより小さければ 0 として扱う（ゲームは float.AlmostEqual。0 になるのは心停止で心拍出量が 0 のときだけ） */
const NO_PERFUSION = 1e-6;

/**
 * 薬を打つ前に、患者の状態だけで進めておく秒数。落ち着いた値から線を始めるため
 * （激痛の患者は、打つ前から心拍数が上がっている。既定の 80 から始めると、実際にはない立ち上がりが線の頭に出る）。
 * 心拍数は 1 s で残りの半分ずつ近づくので、60 s あれば差は表示の桁より十分小さくなる
 */
const SETTLE_SECONDS = 60;
/**
 * Breathing があるときの、進めておく秒数。気胸や酸素マスクのある患者は、肺の酸素と CO2 が落ち着くまでに分の単位でかかる。
 * 600 s と 7200 s で、0 s の値（SpO2・心拍数・平均血圧）が小数 4 桁まで同じになるのを確かめた
 */
const BREATHING_SETTLE_SECONDS = 600;

interface Thresholds {
  heartRateLow: number;
  heartRateHigh: number;
  pressureLowKpa: number;
  pressureHighKpa: number;
  maxHeartRateForPressureLow: number;
  blood: number;
  /** Breathing の Configs/ACE/Settings.conf の m_fSpO2 */
  spo2: number;
}

// Configs/ACE/Settings.conf の m_UnstableThresholds・m_CriticalThresholds・m_CardiacArrestThresholds
const UNSTABLE: Thresholds = {
  heartRateLow: 40,
  heartRateHigh: 220,
  pressureLowKpa: 7.11,
  pressureHighKpa: 29.5,
  maxHeartRateForPressureLow: 80,
  blood: BLOOD_CLASS.two,
  spo2: 85,
};
const CRITICAL: Thresholds = {
  heartRateLow: 30,
  heartRateHigh: 220,
  pressureLowKpa: 5.21,
  pressureHighKpa: 29.5,
  maxHeartRateForPressureLow: 40,
  blood: BLOOD_CLASS.three,
  spo2: 75,
};
const CARDIAC_ARREST: Thresholds = {
  heartRateLow: 20,
  heartRateHigh: 220,
  pressureLowKpa: 5.21,
  pressureHighKpa: 29.5,
  maxHeartRateForPressureLow: 30,
  blood: BLOOD_CLASS.four,
  spo2: 65,
};

type VitalState = "stable" | "unstable" | "critical" | "arrest";

/** 患者の状態。 */
export interface PatientState {
  /** 血液量（血液の HP の割合、0〜1） */
  blood: number;
  /** 痛みの HP の割合（0〜1）。1 で痛みなし、低いほど痛い */
  painHealth: number;
  /** 気道が塞がっている（舌根・嘔吐）。Breathing があるときだけ効く。以下も同じ */
  airwayBlocked: boolean;
  /** 気胸の大きさ（0〜1。ゲームでは 0.18 刻みで、0.75 に達すると心停止） */
  pneumothorax: number;
  /** 緊張性気胸 */
  tension: boolean;
  /** 酸素マスクを付けている */
  mask: boolean;
}

export const HEALTHY_PATIENT: PatientState = {
  blood: 1,
  painHealth: 1,
  airwayBlocked: false,
  pneumothorax: 0,
  tension: false,
  mask: false,
};

/** 途中で患者の状態を変える。時刻 seconds の点は変える前の値で、次の 1 s の更新から効く */
export interface PatientChange {
  seconds: number;
  patch: Partial<PatientState>;
}

export interface VitalsPoint {
  seconds: number;
  heartRate: number;
  meanPressureKpa: number;
  /** Breathing がなければ null */
  spo2: number | null;
}

export interface VitalsTimeline {
  /**
   * 0 s から 1 s ごと。Breathing がなければ、心停止に当たった時刻の点で終わる。
   * Breathing があれば、心停止の後も終わりまで続く（心拍数と血圧は 0、SpO2 は下がり続ける）
   */
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
  /**
   * 0 s の時点の患者の状態。この状態で落ち着いた値から始める。
   * 気道が塞がっている状態だけは落ち着く値がない（SpO2 が下がり続ける）ので、0 s に塞がったものとして扱う
   */
  patient: PatientState;
  /** 計算する長さ（横軸の 0 = atMs の 0 からの秒数） */
  endSeconds: number;
  /** Breathing を使っているか。使っていなければ、呼吸と SpO2 は計算せず、気道・気胸・マスクも効かない */
  breathing?: boolean;
  changes?: readonly PatientChange[];
  /**
   * 計算を始める時刻（0 以下の整数の秒）。0 s より前に打った投与があるときに、その投与から進めるために渡す
   * （心拍数と状態は前の値に依存するので、途中から始めると、前の投与の分が抜ける）。点は 0 s 以降だけを返す
   */
  startSeconds?: number;
  /** 薬を打つ前に進めておく秒数。原稿の表（既定の値から始めた値）と突き合わせるときだけ 0 にする */
  settleSeconds?: number;
}

/** 計算の途中の体の状態。1 s ごとに書き換える */
interface Body {
  state: VitalState;
  heartRate: number;
  /** 心拍出量（ml/分） */
  cardiacOutput: number;
  pressureKpa: number;
  respiratoryRate: number;
  spo2: number;
  alveolarO2Kpa: number;
  alveolarCo2Kpa: number;
  venousCo2: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
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

/** ACE_Medical_VitalStateThresholdTransition.c（SpO2 は Breathing が足す分） */
function hits(thresholds: Thresholds, body: Body, blood: number, breathing: boolean): boolean {
  return (
    body.heartRate < thresholds.heartRateLow ||
    body.heartRate > thresholds.heartRateHigh ||
    (body.pressureKpa < thresholds.pressureLowKpa &&
      body.heartRate <= thresholds.maxHeartRateForPressureLow) ||
    body.pressureKpa > thresholds.pressureHighKpa ||
    blood <= thresholds.blood ||
    (breathing && body.spo2 < thresholds.spo2)
  );
}

/**
 * 次の状態。ACE_Medical_VitalStatesSystem.c の登録順に見て、最初に当たった遷移だけを行う
 * （心停止 → Critical → Unstable の順。戻るのは 1 回の更新で 1 段ずつ）。
 * 心停止から出るのは CPR だけで、ここでは扱わないので、心停止のままにする。
 */
function nextState(body: Body, blood: number, breathing: boolean): VitalState {
  const hit = (thresholds: Thresholds): boolean => hits(thresholds, body, blood, breathing);
  if (body.state === "arrest" || hit(CARDIAC_ARREST)) {
    return "arrest";
  }
  if (body.state === "critical") {
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

/** 心拍数・心拍出量・平均血圧を 1 s 進める（Circulation の ACE_Medical_IVitalState.c の OnUpdate）。 */
function updateCirculation(
  body: Body,
  patient: PatientState,
  breathing: boolean,
  medication: MedicationFile,
  concentrations: ReturnType<typeof concentrationsAt>,
): void {
  if (body.state === "arrest") {
    // ACE_Medical_CardiacArrestState.c: 心拍数も血圧も 0
    body.heartRate = 0;
    body.cardiacOutput = 0;
    body.pressureKpa = 0;
    return;
  }
  // ACE_Medical_CriticalState.c: 出血性ショックの頻脈。前の更新の心拍数と平均血圧から決まる。
  // それ以外は既定の心拍数で、Breathing があれば、前の更新の呼吸数が既定を超えた分を足す
  const base =
    body.state === "critical" && patient.blood < BLOOD_CLASS.three
      ? (body.heartRate * 14.3 * lerp(0.5, 1, patient.blood)) / Math.max(6, body.pressureKpa)
      : DEFAULT_HEART_RATE +
        (breathing
          ? TACHYPNEA_HEART_RATE * Math.max(0, body.respiratoryRate - DEFAULT_RESPIRATORY_RATE)
          : 0);
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
  body.heartRate += (target - body.heartRate) * HEART_RATE_PROGRESS_PER_SECOND;
  // ACE_Medical_IVitalState.c: 1 回拍出量は血液量に比例。緊張性気胸は Breathing が倍率を掛ける
  const strokeVolume =
    DEFAULT_STROKE_VOLUME *
    patient.blood *
    (breathing && patient.tension ? TENSION_STROKE_VOLUME_SCALE : 1);
  body.cardiacOutput = body.heartRate * strokeVolume;
  body.pressureKpa =
    body.cardiacOutput *
    (DEFAULT_RESISTANCE + totalEffect(medication, "vascularResistance", concentrations));
}

/** 呼吸数・肺の酸素と CO2・SpO2 を 1 s 進める（Breathing の ACE_Medical_IVitalState.c の OnUpdate）。 */
function updateBreathing(body: Body, patient: PatientState): void {
  const open = !patient.airwayBlocked;
  const lung = 1 - patient.pneumothorax;
  const masked = patient.mask && open;
  // ComputeRespiratoryRate。心停止は ACE_Medical_CardiacArrestState.c（Breathing）で 0
  body.respiratoryRate =
    body.state === "arrest" || !open
      ? 0
      : Math.min(MAX_RESPIRATORY_RATE, DEFAULT_RESPIRATORY_RATE / lung);

  // UpdateOxygenMetabolism: SpO2 が下がると、消費を減らす
  const lambda =
    (clamp(body.spo2, HYPOXIC_SPO2, DEFAULT_SPO2) - HYPOXIC_SPO2) / (DEFAULT_SPO2 - HYPOXIC_SPO2);
  const consumption = lerp(OXYGEN_CONSUMPTION.hypoxic, OXYGEN_CONSUMPTION.normal, lambda);
  const production = consumption * lerp(EXCHANGE_RATIO.hypoxic, EXCHANGE_RATIO.normal, lambda);

  // UpdateVentilation
  const capacity = LUNG_CAPACITY_ML * lung;
  const breathRate = ((body.respiratoryRate / 60) * (TIDAL_VOLUME_ML * lung)) / capacity;
  const ventilation = masked ? Math.max(MASK_MIN_VENTILATION, breathRate) : breathRate;
  const alveolarO2Max = masked ? ALVEOLAR_O2_MAX_WITH_MASK_KPA : ALVEOLAR_O2_MAX_KPA;
  const ventO2 = ventilation * (alveolarO2Max - body.alveolarO2Kpa);
  const ventCo2 = ventilation * body.alveolarCo2Kpa;

  // UpdatePerfusion
  const bloodVolume = BLOOD_MAX_HEALTH + BLOOD_MAX_HEALTH * patient.blood;
  const arterial = ARTERIAL_BLOOD_SHARE * bloodVolume;
  const venous = VENOUS_BLOOD_SHARE * bloodVolume;
  const perfusion = (body.cardiacOutput / 60) * lung ** (2 / 3);
  let perfO2 = 0;
  let perfCo2 = 0;
  if (Math.abs(perfusion) >= NO_PERFUSION) {
    const ratio = (body.alveolarO2Kpa / HEMOGLOBIN_KD_KPA) ** HEMOGLOBIN_HILL;
    const alveolarSaturation = ratio / (1 + ratio);
    // 静脈の飽和度 = SpO2 から、体を 1 周する間に使う分を引いた値
    const saturationLoss = (60 / body.cardiacOutput / HEME_CONCENTRATION) * consumption;
    const venousSaturation = Math.max(0, body.spo2 / 100 - saturationLoss);
    const shift = alveolarSaturation - venousSaturation;
    perfO2 = clamp(shift, -venousSaturation, Math.max(0, shift)) * perfusion * HEME_CONCENTRATION;
    const co2Shift = body.venousCo2 - CO2_SOLUBILITY * body.alveolarCo2Kpa;
    // 1 回の更新で平衡を越えないための上限
    const maxRate =
      1 / (1 / venous + (GAS_CONSTANT_TIMES_TEMPERATURE * CO2_SOLUBILITY) / capacity) / perfusion;
    perfCo2 =
      Math.min(
        Math.min(CARBONATE_RATE_SCALE, maxRate) * co2Shift,
        body.venousCo2 + BLOOD_BICARBONATE,
      ) * perfusion;
  }

  const gasPerVolume = GAS_CONSTANT_TIMES_TEMPERATURE / capacity;
  body.alveolarO2Kpa = clamp(body.alveolarO2Kpa + ventO2 - gasPerVolume * perfO2, 0, alveolarO2Max);
  body.spo2 =
    100 * clamp(body.spo2 / 100 + (perfO2 - consumption) / arterial / HEME_CONCENTRATION, 0, 1);
  body.venousCo2 += (production - perfCo2) / venous;
  body.alveolarCo2Kpa = Math.max(body.alveolarCo2Kpa + gasPerVolume * perfCo2 - ventCo2, 0);
}

/** 時刻 seconds の更新で使う患者の状態。 */
function patientAt(
  base: PatientState,
  changes: readonly PatientChange[],
  seconds: number,
): PatientState {
  // 気道の閉塞は、0 s に塞がったものとして扱う（塞がったままでは、打つ前の落ち着いた値がない）
  const patient: PatientState = { ...base, airwayBlocked: base.airwayBlocked && seconds > 0 };
  for (const change of changes) {
    if (change.seconds < seconds) {
      Object.assign(patient, change.patch);
    }
  }
  return patient;
}

/** 投与と患者の状態から、心拍数・平均血圧・SpO2 を 1 s ごとに進める。 */
export function simulateVitals(input: VitalsInput): VitalsTimeline {
  const { medication, doses, endSeconds } = input;
  const breathing = input.breathing ?? false;
  const changes = (input.changes ?? []).toSorted((a, b) => a.seconds - b.seconds);
  const settleSeconds =
    input.settleSeconds ?? (breathing ? BREATHING_SETTLE_SECONDS : SETTLE_SECONDS);
  const startSeconds = input.startSeconds ?? 0;
  const firstSeconds = startSeconds - settleSeconds;
  const first = patientAt(input.patient, changes, firstSeconds);
  const body: Body = {
    state: "stable",
    heartRate: DEFAULT_HEART_RATE,
    cardiacOutput: DEFAULT_HEART_RATE * DEFAULT_STROKE_VOLUME * first.blood,
    pressureKpa: DEFAULT_HEART_RATE * DEFAULT_STROKE_VOLUME * first.blood * DEFAULT_RESISTANCE,
    respiratoryRate: DEFAULT_RESPIRATORY_RATE,
    spo2: DEFAULT_SPO2,
    alveolarO2Kpa: DEFAULT_ALVEOLAR_O2_KPA,
    alveolarCo2Kpa: DEFAULT_ALVEOLAR_CO2_KPA,
    venousCo2: DEFAULT_VENOUS_CO2,
  };
  let unconsciousAtSeconds: number | null = null;
  let arrestAtSeconds: number | null = null;
  const points: VitalsPoint[] = [];

  for (let seconds = firstSeconds; seconds <= endSeconds; seconds += 1) {
    // 始めの点（進める前の値）は、更新せずにそのまま出す
    if (seconds > firstSeconds) {
      const patient = patientAt(input.patient, changes, seconds);
      const concentrations = concentrationsAt(medication, doses, seconds * MS);
      updateCirculation(body, patient, breathing, medication, concentrations);
      if (breathing) {
        updateBreathing(body, patient);
      }
      body.state = nextState(body, patient.blood, breathing);
    }
    if (body.state === "arrest") {
      arrestAtSeconds ??= Math.max(seconds, startSeconds);
      unconsciousAtSeconds ??= Math.max(arrestAtSeconds, 0);
    } else if (body.state === "critical" && seconds >= 0) {
      unconsciousAtSeconds ??= seconds;
    }
    if (seconds >= 0) {
      points.push({
        seconds,
        heartRate: body.heartRate,
        meanPressureKpa: body.pressureKpa,
        spo2: breathing ? body.spo2 : null,
      });
    }
    // 心停止の後は、心拍数も血圧も 0 のまま（ACE_Medical_CardiacArrestState.c）。蘇生は扱わないので、
    // Breathing がなければここで終える。Breathing があれば、SpO2 が下がり続けるので終わりまで進める
    if (body.state === "arrest" && !breathing) {
      break;
    }
  }
  return { points, unconsciousAtSeconds, arrestAtSeconds };
}
