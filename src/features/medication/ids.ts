// 薬と効果の id。画面も使うので、形の検査（zod）を持つ schema.ts と分けてある
// （一緒にすると、負傷者の画面を載せる最初の JS に zod が入る）

/** 濃度の仕組みがある薬。炭酸アンモニウムは濃度の仕組みがないので含まない */
export const DRUG_IDS = [
  "epinephrine",
  "metoprolol",
  "morphine",
  "naloxone",
  "phenylephrine",
] as const;
export type DrugId = (typeof DRUG_IDS)[number];

export const EFFECT_IDS = [
  "heartRate",
  "vascularResistance",
  "analgesia",
  "bleedingRate",
  "reviveFrequency",
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];
