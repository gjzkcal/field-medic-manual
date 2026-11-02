// 濃度と効果の計算。ACE Medical Circulation の式（ACE_Medical_Bolus.c・ACE_Medical_PharmacodynamicsConfig.c）を写したもの。
// 画面には依存しない純粋な関数にして、原稿の表とテストで突き合わせる。
import type {
  DrugConfig,
  DrugId,
  EffectConfig,
  EffectDrugConfig,
  EffectId,
  MedicationFile,
} from "@/features/medication/schema";

/** 打ってから消えるまでの基準（1 本の量に対する濃度の割合） */
const EXPIRED_RATIO = 0.01;
// メトプロロールは ka と kd の差が約 2e-7 しかなく、そのままの式では分母がほとんど 0 になる。
// この差より近ければ ka = kd のときの式を使う（調査の計算と同じ閾値）
const SAME_RATE_EPSILON = 1e-5;

export type Concentrations = Partial<Record<DrugId, number>>;

// 消える時刻は濃度を計算するたびに要り、モルヒネは 5000 回ほどの繰り返しになるので、薬ごとに覚える
const expirySeconds = new WeakMap<DrugConfig, number>();

/** 1 本の濃度の式。体内から取り除かれるかどうかは見ない。t は打ってからの秒数 */
function rawConcentration(drug: DrugConfig, t: number): number {
  const { doseNm, activationRate: ka, deactivationRate: kd } = drug;
  if (Math.abs(ka - kd) < SAME_RATE_EPSILON) {
    return doseNm * kd * t * Math.exp(-kd * t);
  }
  return ((doseNm * ka) / (ka - kd)) * (Math.exp(-kd * t) - Math.exp(-ka * t));
}

/**
 * 1 本が体内から取り除かれる時刻（打ってからの秒数）。ゲームは経過時間を整数の秒にして判定するので、
 * 1/ka を超えて濃度が 1 本の量の 1% を下回る最初の整数の秒を返す（原稿の表も同じ値）。
 */
export function doseExpirySeconds(drug: DrugConfig): number {
  const known = expirySeconds.get(drug);
  if (known !== undefined) {
    return known;
  }
  let t = Math.floor(1 / drug.activationRate) + 1;
  while (rawConcentration(drug, t) >= EXPIRED_RATIO * drug.doseNm) {
    t += 1;
  }
  expirySeconds.set(drug, t);
  return t;
}

/** 1 本の濃度（nM）。打つ前と、体内から取り除かれた後は 0 */
export function doseConcentration(drug: DrugConfig, t: number): number {
  return t <= 0 || t >= doseExpirySeconds(drug) ? 0 : rawConcentration(drug, t);
}

export function drugConfig(medication: MedicationFile, id: DrugId): DrugConfig {
  const drug = medication.drugs.find((d) => d.id === id);
  if (drug === undefined) {
    throw new Error(`薬の数値がありません: ${id}`);
  }
  return drug;
}

function effectConfig(medication: MedicationFile, id: EffectId): EffectConfig {
  const effect = medication.effects.find((e) => e.id === id);
  if (effect === undefined) {
    throw new Error(`効果の数値がありません: ${id}`);
  }
  return effect;
}

/** 効果の強さ χ。拮抗薬の χ の和で割ってから Hill 係数を掛ける */
function chi(config: EffectDrugConfig, concentrations: Concentrations): number {
  const antagonism = (config.antagonists ?? []).reduce(
    (sum, a) => sum + (concentrations[a.drug] ?? 0) / a.ec50,
    1,
  );
  const ratio = (concentrations[config.drug] ?? 0) / config.ec50 / antagonism;
  return ratio === 0 ? 0 : Math.sign(ratio) * Math.abs(ratio) ** (config.gamma ?? 1);
}

/**
 * 1 つの薬の分の効果。直線の効果は χ、頭打ちの効果は 最大効果 × χ/(1+χ)。
 * ゲームは同じ効果の薬を足し合わせるが、カードは薬ごとなので、その薬の分だけを返す。
 */
export function drugEffect(
  medication: MedicationFile,
  effectId: EffectId,
  drug: DrugId,
  concentrations: Concentrations,
): number {
  const effect = effectConfig(medication, effectId);
  const config = effect.drugs.find((d) => d.drug === drug);
  if (config === undefined) {
    return 0;
  }
  const value = chi(config, concentrations);
  return effect.kind === "hill" ? ((effect.maxEffect ?? 1) * value) / (1 + value) : value;
}

/** モルヒネの濃度をナロキソンが割る分の割合（0〜1）。ナロキソンのカードの効能 */
export function antagonismRatio(
  medication: MedicationFile,
  concentrations: Concentrations,
): number {
  const config = effectConfig(medication, "analgesia").drugs[0]?.antagonists?.[0];
  if (config === undefined) {
    return 0;
  }
  const value = (concentrations[config.drug] ?? 0) / config.ec50;
  return value / (1 + value);
}

/** 薬のカードの主な効能の値（符号付き）。 */
export function primaryEffect(
  medication: MedicationFile,
  drug: DrugId,
  concentrations: Concentrations,
): number {
  const { primaryEffect: effect } = drugConfig(medication, drug);
  return effect === "antagonism"
    ? antagonismRatio(medication, concentrations)
    : drugEffect(medication, effect, drug, concentrations);
}

/** 1 本の濃度が最大になる時刻（打ってからの秒数）。 */
export function peakSeconds(drug: DrugConfig): number {
  const { activationRate: ka, deactivationRate: kd } = drug;
  return Math.abs(ka - kd) < SAME_RATE_EPSILON ? 1 / kd : Math.log(ka / kd) / (ka - kd);
}

/** ほかの薬のいない 1 本のピークでの、主な効能の大きさ。バーと 50% の基準になる */
export function singleDosePeak(medication: MedicationFile, id: DrugId): number {
  const drug = drugConfig(medication, id);
  const peak = doseConcentration(drug, peakSeconds(drug));
  return Math.abs(primaryEffect(medication, id, { [id]: peak }));
}
