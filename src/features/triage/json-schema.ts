// フローの JSON Schema を zod の定義から作る。content/flows/ に置き、フローの `$schema` から指す。
// VS Code の YAML / JSON 拡張が `$schema` を読み、キーの補完・書き間違いの表示・説明のホバーを出すため。
// アプリの実行時には使わない（pnpm test で生成する。json-schema.test.ts）。
import { z } from "zod";

import { flowSchema } from "@/features/triage/schema";

/** 生成した JSON Schema の文字列（末尾に改行）。 */
export function flowJsonSchemaText(): string {
  const schema = z.toJSONSchema(flowSchema, {
    // YAML 拡張（yaml-language-server）が確実に読める版にする
    target: "draft-7",
    // 作者が書く側（入力）の形。YAML の日付を文字列に直す前の形になる
    io: "input",
    // z.custom などは .meta() で型を補っているので、表せない部分は制約なしにして生成を止めない
    unrepresentable: "any",
  });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
