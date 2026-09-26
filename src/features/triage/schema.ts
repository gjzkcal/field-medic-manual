// トリアージフローの形（dev-docs/reference/triage-format.md §2）。
// ここでは形だけを確かめ、つながり（next の行き先、到達可能性など）は validate.ts の V1〜V8 で確かめる。
// .meta() の説明と値の一覧は、ここから生成する JSON Schema（json-schema.ts）に載り、エディタの補完とホバーに出る。
import { z } from "zod";

import { isIsoDate, isModChannel, isModTarget, MOD_TARGET_VALUES } from "@/features/content/meta";
import { FLOW_LINK_PATTERN, parseFlowLink } from "@/features/triage/links";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";

/** フローの形式の版を表すスキーマのファイル名。フローの `$schema` にはこれを同じフォルダからの相対パスで書く */
export const FLOW_SCHEMA_FILE = "triage-flow.v1.schema.json";
export const FLOW_SCHEMA_ID = `./${FLOW_SCHEMA_FILE}`;

const text = z.string().trim().min(1, "空にできません");

// 値の一覧は Rust から生成した型を正にするため、列挙を書き写さず meta.ts の判定を使う
const modTarget = z
  .custom<ModTarget>(
    (v) => typeof v === "string" && isModTarget(v),
    "対象モジュールは core / hitzones / circulation / breathing / defibrillation / ai / general のどれかです",
  )
  .meta({ type: "string", enum: MOD_TARGET_VALUES });
const modChannel = z
  .custom<ModChannel>(
    (v) => typeof v === "string" && isModChannel(v),
    "版は release / dev のどちらかです",
  )
  .meta({ type: "string", enum: ["release", "dev"] });

// YAML の書き方によっては日付が Date になるので、YYYY-MM-DD の文字列に揃える
const isoDate = z
  .preprocess(
    (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
    z.string().refine(isIsoDate, "YYYY-MM-DD で書いてください"),
  )
  .meta({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

const link = z
  .string()
  .refine(
    (v) => parseFlowLink(v) !== null,
    "リンクは doc:<ファイル名>#<アンカー> / flow:<id> / quickref:<id> / https://... のどれかです",
  )
  .meta({
    pattern: FLOW_LINK_PATTERN,
    description: "doc:<ファイル名>#<アンカー> / flow:<id> / quickref:<id> / https://...",
  });

const help = text.meta({
  description: "補足（折りたたみで表示）。処置の未確認点は【要確認】と書く",
});
const links = z.array(link).meta({ description: "関連ページ" });

export const choiceSchema = z.strictObject({
  label: text.meta({ description: "ボタンの文言" }),
  next: text.meta({ description: "選んだときに進むノードの id" }),
  tone: z
    .enum(["yes", "no", "neutral", "danger"])
    .optional()
    .meta({ description: "ボタンの色（yes = 緑、no = 青、danger = 赤）" }),
});

// 作者の書き間違い（help を hlep と書くなど）に気づけるよう、知らないキーはエラーにする
const questionSchema = z.strictObject({
  type: z.literal("question"),
  text: text.meta({ description: "質問" }),
  help: help.optional(),
  choices: z.array(choiceSchema).meta({ description: "選択肢（2〜4 個。1〜4 のキーで選ぶ）" }),
});

// 物品を持っていないときの行き先。現場で物品が足りなくてもフローが止まらないようにする
const ifMissingSchema = z
  .strictObject({
    next: text.meta({ description: "持っていないときに進むノードの id" }),
    /** 省略時は items を「・」でつないだ「〇〇を持っていない」 */
    label: text
      .optional()
      .meta({ description: "ボタンの文言。省略時は「<items を・でつないだもの>を持っていない」" }),
  })
  .meta({ description: "物品を持っていないときの行き先（items があれば必須）" });

const actionSchema = z.strictObject({
  type: z.literal("action"),
  text: text.meta({ description: "やること" }),
  help: help.optional(),
  items: z.array(text).optional().meta({ description: "使う物品" }),
  ifMissing: ifMissingSchema.optional(),
  links: links.optional(),
  timerSec: z
    .int()
    .positive()
    .optional()
    .meta({ description: "カウントダウンの秒数（CPR のサイクルなど）" }),
  next: text.meta({ description: "「次へ」で進むノードの id" }),
});

const endSchema = z.strictObject({
  type: z.literal("end"),
  text: text.meta({ description: "結果" }),
  help: help.optional(),
  outcome: z
    .enum(["ok", "warn", "critical"])
    .meta({ description: "結果の色（ok = 緑、warn = 黄、critical = 赤）" }),
  links: links.optional(),
});

const subflowSchema = z.strictObject({
  type: z.literal("subflow"),
  flowId: text.meta({ description: "呼び出すフローの id" }),
  next: text.meta({ description: "サブフローが end に着いたら戻る先のノードの id" }),
});

export const nodeSchema = z.discriminatedUnion("type", [
  questionSchema,
  actionSchema,
  endSchema,
  subflowSchema,
]);

export const flowSchema = z
  .strictObject({
    $schema: z.literal(FLOW_SCHEMA_ID),
    id: text.meta({ description: "英小文字・数字・ハイフン。ファイル名 <id>.flow.yaml と揃える" }),
    title: text,
    description: text.optional(),
    modTarget: z
      .array(modTarget)
      .optional()
      .meta({ description: "前提にしている ACE Medical のモジュール" }),
    modChannel: modChannel.optional().meta({ description: "ACE の版。省略 = 版を問わない" }),
    verifiedAt: isoDate.optional().meta({ description: "内容を確認した日（YYYY-MM-DD）" }),
    version: z.int().positive().optional(),
    start: text.meta({ description: "最初のノードの id" }),
    nodes: z.record(z.string(), nodeSchema).meta({ description: "ノード（キーがノードの id）" }),
  })
  .meta({ title: "トリアージフロー（Field Medic Manual）" });

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
