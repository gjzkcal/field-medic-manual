// クイック表の原稿（content/quickref.yaml）の形。書き方の決まりは content/quickref.yaml の先頭のコメント。
// .meta() の説明と値の一覧は、ここから生成する JSON Schema（json-schema.test.ts）に載り、エディタの補完とホバーに出る。
import { z } from "zod";

import { SEVERITY_NAMES, severityOfName } from "@/features/quickref/severity";
import { SELECTABLE_MODS } from "@/features/settings/mod-settings";
import { isoDate, link, modChannel, text } from "@/features/triage/schema";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";

export const QUICKREF_SCHEMA_FILE = "quickref.v1.schema.json";
export const QUICKREF_SCHEMA_ID = `./${QUICKREF_SCHEMA_FILE}`;

/** マニュアルの原稿のタグ（front matter の tags）と同じ分類語から「管理者向け」を除いたもの。タブはファイルに出てきた順に並べる */
export const QUICKREF_CATEGORIES = ["出血", "循環", "気道・呼吸", "意識", "薬・物品"] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// core・general は常に有効なので、withoutMods に書くと決して出ない行になる。設定で選べる MOD だけを受け付ける
const selectableMod = z
  .enum(SELECTABLE_MODS)
  .meta({ description: "設定の「使っている MOD」で選べる MOD" });

// 作者の書き間違い（notes を note と書くなど）に気づけるよう、知らないキーはエラーにする
const rowSchema = z
  .strictObject({
    id: z.string().regex(SLUG, "英小文字・数字・ハイフンで書いてください").meta({
      description:
        "英小文字・数字・ハイフン。お気に入りと quickref:<id> のリンクで使うので変えない",
    }),
    category: z.enum(QUICKREF_CATEGORIES).meta({ description: "カテゴリ（画面のタブ）" }),
    symptom: text.meta({ description: "症状（ゲーム内で見える様子）" }),
    severity: z.enum(SEVERITY_NAMES).meta({
      description: "致命的 = 数分で心停止・死亡 / 重度 = 放っておくと心停止に進む / 中等度 / 軽度",
    }),
    treatment: z
      .array(text)
      .min(1, "手順を 1 つ以上書いてください")
      .meta({ description: "手順（1 要素 1 動作。番号付きで表示）" }),
    items: z.array(text).optional().meta({ description: "使う物品" }),
    notes: text.optional().meta({ description: "備考" }),
    links: z.array(link).min(1, "根拠の原稿の節（doc:）を 1 つ以上書いてください").meta({
      description: "関連ページ。根拠の原稿の節を doc:<ファイル名>#<アンカー> で 1 つ以上",
    }),
    mods: z
      .array(selectableMod)
      .optional()
      .meta({ description: "この MOD をすべて入れているときだけ出す" }),
    withoutMods: z
      .array(selectableMod)
      .optional()
      .meta({ description: "この MOD をどれも入れていないときだけ出す" }),
  })
  .superRefine((row, ctx) => {
    const overlap = (row.mods ?? []).filter((m) => row.withoutMods?.includes(m) === true);
    if (overlap.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["withoutMods"],
        message: `mods と withoutMods の両方に書いた MOD があり、決して表示されません: ${overlap.join(", ")}`,
      });
    }
  });

export const quickrefFileSchema = z
  .strictObject({
    $schema: z.literal(QUICKREF_SCHEMA_ID),
    modChannel: modChannel.optional().meta({ description: "ACE の版。省略 = 版を問わない" }),
    verifiedAt: isoDate.meta({ description: "内容を確認した日（YYYY-MM-DD）" }),
    rows: z
      .array(rowSchema)
      .min(1, "行を 1 つ以上書いてください")
      .meta({ description: "行（上から順に表示）" }),
  })
  .superRefine((file, ctx) => {
    // id はお気に入りとリンクの行き先なので、重なると別の行を開いてしまう
    const seen = new Set<string>();
    file.rows.forEach((row, i) => {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i, "id"],
          message: `id が重複しています: ${row.id}`,
        });
      }
      seen.add(row.id);
    });
  })
  .meta({ title: "症状→処置 クイック表（Field Medic Manual）" });

export type QuickrefFile = z.infer<typeof quickrefFileSchema>;

export type QuickrefParseResult =
  { ok: true; file: QuickrefFile } | { ok: false; messages: string[] };

/** YAML を読んだ値を、クイック表として読む。形が違えば、どこが違うかを文言で返す。 */
export function parseQuickref(value: unknown): QuickrefParseResult {
  const result = quickrefFileSchema.safeParse(value);
  if (result.success) {
    return { ok: true, file: result.data };
  }
  return {
    ok: false,
    messages: result.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    }),
  };
}

/** DB に入れる行（Rust の QuickrefRow）にする。 */
export function toQuickrefRows(file: QuickrefFile): QuickrefRow[] {
  return file.rows.map((row) => ({
    id: row.id,
    category: row.category,
    symptom: row.symptom,
    severity: severityOfName(row.severity),
    treatment: row.treatment,
    items: row.items ?? [],
    notes: row.notes ?? null,
    links: row.links,
    mods: row.mods ?? [],
    withoutMods: row.withoutMods ?? [],
  }));
}
