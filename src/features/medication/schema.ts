// 薬の数値（content/medication.yaml）の形。.meta() の説明は、ここから生成する JSON Schema に載り、エディタの補完に出る。
import { isoDate, modChannel } from "@/features/triage/schema";
import { z } from "@/lib/zod";

export const MEDICATION_SCHEMA_FILE = "medication.v1.schema.json";
export const MEDICATION_SCHEMA_ID = `./${MEDICATION_SCHEMA_FILE}`;

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

const drugId = z.enum(DRUG_IDS);
const positive = z.number().positive();

const overdosePairSchema = z.strictObject({
  noPain: positive.meta({ description: "痛みなし" }),
  severePain: positive.meta({ description: "激痛（痛みの HP 30%）" }),
});

const drugSchema = z.strictObject({
  id: drugId,
  doseNm: positive.meta({ description: "1 本の量 C0（nM）" }),
  activationRate: positive.meta({ description: "吸収の速さ ka（1/s）" }),
  deactivationRate: positive.meta({ description: "消える速さ kd（1/s）" }),
  primaryEffect: z.enum([...EFFECT_IDS, "antagonism"]).meta({
    description: "タイマーとグラフに使う効能。antagonism はほかの薬を弱める割合",
  }),
  overdoseDoses: z
    .strictObject({ unconscious: overdosePairSchema, arrest: overdosePairSchema })
    .optional()
    .meta({
      description:
        "同時に打って意識喪失・心停止になる最小の本数（血液 100%）。過量投与のない薬は省略",
    }),
});

const effectDrugSchema = z.strictObject({
  drug: drugId,
  ec50: z.number().meta({ description: "EC50（nM）。効果を下げる薬は負の値" }),
  gamma: positive.optional().meta({ description: "Hill 係数。省略 = 1" }),
  antagonists: z
    .array(z.strictObject({ drug: drugId, ec50: positive }))
    .optional()
    .meta({ description: "この効果を弱める薬" }),
});

const effectSchema = z.strictObject({
  id: z.enum(EFFECT_IDS),
  kind: z.enum(["linear", "hill"]).meta({ description: "linear = χ の和 / hill = 頭打ち" }),
  maxEffect: positive.optional().meta({ description: "頭打ちの効果の最大" }),
  drugs: z.array(effectDrugSchema).min(1),
});

export const medicationFileSchema = z
  .strictObject({
    $schema: z.literal(MEDICATION_SCHEMA_ID),
    modChannel: modChannel.meta({ description: "ACE の版" }),
    verifiedAt: isoDate.meta({ description: "内容を確認した日（YYYY-MM-DD）" }),
    baseVascularResistance: positive.meta({ description: "既定の血管抵抗" }),
    salineSeconds: positive.meta({ description: "生理食塩水を入れ終わるまでの秒数" }),
    coreLockSeconds: z
      .strictObject({ epinephrine: positive, morphine: positive })
      .meta({ description: "Circulation なしで次を打てない秒数" }),
    drugs: z.array(drugSchema).length(DRUG_IDS.length, "5 つの薬をすべて書いてください"),
    effects: z.array(effectSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set(file.drugs.map((d) => d.id));
    if (ids.size !== DRUG_IDS.length) {
      ctx.addIssue({ code: "custom", path: ["drugs"], message: "薬の id が重複しています" });
    }
    file.effects.forEach((effect, i) => {
      if (effect.kind === "hill" && effect.maxEffect === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["effects", i, "maxEffect"],
          message: "頭打ちの効果には maxEffect を書いてください",
        });
      }
    });
  })
  .meta({ title: "薬の数値（Field Medic Manual）" });

export type MedicationFile = z.infer<typeof medicationFileSchema>;
export type DrugConfig = MedicationFile["drugs"][number];
export type EffectConfig = MedicationFile["effects"][number];
export type EffectDrugConfig = EffectConfig["drugs"][number];

/** 不正なら、どこが違うかを 1 行にまとめた Error を投げる。同梱のファイルなので、ふつうはテストで先に見つかる */
export function parseMedication(value: unknown): MedicationFile {
  const result = medicationFileSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const messages = result.error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });
  throw new Error(`薬の数値を読めません: ${messages.join(" / ")}`);
}
