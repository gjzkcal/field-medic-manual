// 用語集（content/glossary.yaml）の形。書き方の決まりは content/glossary.yaml の先頭のコメント。
// 用語集はアプリに同梱せず、テスト（glossary.test.ts）で原稿の表記を確かめるのにだけ使う。
// .meta() の説明と値の一覧は、ここから生成する JSON Schema（json-schema.test.ts）に載り、エディタの補完とホバーに出る。
import { isoDate, modChannel, text } from "@/features/triage/schema";
import { z } from "@/lib/zod";

export const GLOSSARY_SCHEMA_FILE = "glossary.v1.schema.json";
export const GLOSSARY_SCHEMA_ID = `./${GLOSSARY_SCHEMA_FILE}`;

export const GLOSSARY_MODS = ["reforger", "core", "circulation", "breathing"] as const;
export const GLOSSARY_KINDS = [
  "item",
  "action",
  "menu",
  "failReason",
  "notification",
  "state",
  "diagnosis",
  "description",
  "hint",
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// 作者の書き間違い（manual を manuals と書くなど）に気づけるよう、知らないキーはエラーにする
const termSchema = z
  .strictObject({
    id: z.string().regex(SLUG, "英小文字・数字・ハイフンで書いてください").meta({
      description: "英小文字・数字・ハイフン。テストの失敗の表示で使う",
    }),
    mod: z
      .enum(GLOSSARY_MODS)
      .meta({ description: "表示名を定義している MOD（reforger = ゲーム本体）" }),
    kind: z.enum(GLOSSARY_KINDS).meta({
      description:
        "item = 物品 / action = 操作 / menu = ラジアルメニュー / failReason = 使えない理由 / notification = 通知 / state = 状態 / diagnosis = 診察の表示 / description = 説明文 / hint = ヒント",
    }),
    stringId: text
      .optional()
      .meta({ description: "文字列表のキー。prefab に名前を直に書いている物は省く" }),
    en: text.meta({ description: "英語で遊んでいるときの表示" }),
    ja: text.optional().meta({
      description: "日本語で遊んでいるときの表示。日本語で出るものにだけ書く",
    }),
    manual: text.optional().meta({
      description: "日本語で遊んでいても英語で出るものを、原稿で何と呼ぶか。ja と一緒には書かない",
    }),
  })
  .superRefine((term, ctx) => {
    // ja は「画面が日本語」、manual は「画面が英語」の印なので、両方あると検査の規則が決まらない
    if (term.ja !== undefined && term.manual !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["manual"],
        message: "ja と manual は一緒に書けません（画面が日本語なら ja、英語なら manual）",
      });
    }
  });

export const glossaryFileSchema = z
  .strictObject({
    $schema: z.literal(GLOSSARY_SCHEMA_ID),
    modChannel: modChannel.meta({ description: "表示名を確かめた ACE の版" }),
    verifiedAt: isoDate.meta({ description: "表示名を確かめた日（YYYY-MM-DD）" }),
    terms: z
      .array(termSchema)
      .min(1, "用語を 1 つ以上書いてください")
      .meta({ description: "用語" }),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const [i, term] of file.terms.entries()) {
      if (seen.has(term.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["terms", i, "id"],
          message: `id が重複しています: ${term.id}`,
        });
      }
      seen.add(term.id);
    }
  })
  .meta({ title: "ゲームの表示名の用語集（Field Medic Manual）" });

export type GlossaryFile = z.infer<typeof glossaryFileSchema>;
export type GlossaryTerm = GlossaryFile["terms"][number];
