// 同梱する原稿（フロー・クイック表）の JSON Schema を zod の定義から作る。
// VS Code の YAML / JSON 拡張が原稿の `$schema` を読み、キーの補完・書き間違いの表示・説明のホバーを出すため。
// アプリの実行時には使わない（pnpm test で生成する）。
import { z } from "zod";

/** 生成した JSON Schema の文字列（末尾に改行）。 */
export function jsonSchemaText(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, {
    // YAML 拡張（yaml-language-server）が確実に読める版にする
    target: "draft-7",
    // 作者が書く側（入力）の形。YAML の日付を文字列に直す前の形になる
    io: "input",
    // z.custom などは .meta() で型を補っているので、表せない部分は制約なしにして生成を止めない
    unrepresentable: "any",
  });
  return `${JSON.stringify(json, null, 2)}\n`;
}
