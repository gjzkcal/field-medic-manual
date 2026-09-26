// トリアージフローの形（dev-docs/reference/triage-format.md §2）。
// ここでは形だけを確かめ、つながり（next の行き先、到達可能性など）は validate.ts の V1〜V8 で確かめる。
import { z } from "zod";

import { isIsoDate, isModChannel, isModTarget } from "@/features/content/meta";
import { parseFlowLink } from "@/features/triage/links";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";

export const FLOW_SCHEMA_ID = "ace-triage/v1";

const text = z.string().trim().min(1, "空にできません");

// 値の一覧は Rust から生成した型を正にするため、列挙を書き写さず meta.ts の判定を使う
const modTarget = z.custom<ModTarget>(
  (v) => typeof v === "string" && isModTarget(v),
  "対象モジュールは core / hitzones / circulation / breathing / defibrillation / ai / general のどれかです",
);
const modChannel = z.custom<ModChannel>(
  (v) => typeof v === "string" && isModChannel(v),
  "版は release / dev のどちらかです",
);

// YAML の書き方によっては日付が Date になるので、YYYY-MM-DD の文字列に揃える
const isoDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().refine(isIsoDate, "YYYY-MM-DD で書いてください"),
);

const link = z
  .string()
  .refine(
    (v) => parseFlowLink(v) !== null,
    "リンクは doc:<ファイル名>#<アンカー> / flow:<id> / quickref:<id> / https://... のどれかです",
  );

export const choiceSchema = z.strictObject({
  label: text,
  next: text,
  tone: z.enum(["yes", "no", "neutral", "danger"]).optional(),
});

// 作者の書き間違い（help を hlep と書くなど）に気づけるよう、知らないキーはエラーにする
const questionSchema = z.strictObject({
  type: z.literal("question"),
  text,
  help: text.optional(),
  choices: z.array(choiceSchema),
});

// 物品を持っていないときの行き先。現場で物品が足りなくてもフローが止まらないようにする
const ifMissingSchema = z.strictObject({
  next: text,
  /** 省略時は items を「・」でつないだ「〇〇を持っていない」 */
  label: text.optional(),
});

const actionSchema = z.strictObject({
  type: z.literal("action"),
  text,
  help: text.optional(),
  items: z.array(text).optional(),
  ifMissing: ifMissingSchema.optional(),
  links: z.array(link).optional(),
  timerSec: z.int().positive().optional(),
  next: text,
});

const endSchema = z.strictObject({
  type: z.literal("end"),
  text,
  help: text.optional(),
  outcome: z.enum(["ok", "warn", "critical"]),
  links: z.array(link).optional(),
});

const subflowSchema = z.strictObject({
  type: z.literal("subflow"),
  flowId: text,
  next: text,
});

export const nodeSchema = z.discriminatedUnion("type", [
  questionSchema,
  actionSchema,
  endSchema,
  subflowSchema,
]);

export const flowSchema = z.strictObject({
  $schema: z.literal(FLOW_SCHEMA_ID),
  id: text,
  title: text,
  description: text.optional(),
  modTarget: z.array(modTarget).optional(),
  modChannel: modChannel.optional(),
  verifiedAt: isoDate.optional(),
  version: z.int().positive().optional(),
  start: text,
  nodes: z.record(z.string(), nodeSchema),
});

export type Flow = z.infer<typeof flowSchema>;
export type FlowNode = z.infer<typeof nodeSchema>;
export type QuestionNode = z.infer<typeof questionSchema>;
export type ActionNode = z.infer<typeof actionSchema>;
export type EndNode = z.infer<typeof endSchema>;
export type Choice = z.infer<typeof choiceSchema>;
export type ChoiceTone = NonNullable<Choice["tone"]>;
export type Outcome = EndNode["outcome"];

export type ParseResult = { ok: true; flow: Flow } | { ok: false; messages: string[] };

/** JSON / YAML を読んだ値を、フローとして読む。形が違えば、どこが違うかを文言で返す。 */
export function parseFlow(value: unknown): ParseResult {
  const result = flowSchema.safeParse(value);
  if (result.success) {
    return { ok: true, flow: result.data };
  }
  return {
    ok: false,
    messages: result.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    }),
  };
}
