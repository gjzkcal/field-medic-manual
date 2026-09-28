// フローの JSON Schema を zod の定義から作る。content/flows/ に置き、フローの `$schema` から指す。
// VS Code の YAML / JSON 拡張が `$schema` を読み、キーの補完・書き間違いの表示・説明のホバーを出すため。
// アプリの実行時には使わない（pnpm test で生成する。json-schema.test.ts）。
import { flowSchema } from "@/features/triage/schema";
import { jsonSchemaText } from "@/lib/json-schema";

/** 生成した JSON Schema の文字列（末尾に改行）。 */
export function flowJsonSchemaText(): string {
  return jsonSchemaText(flowSchema);
}
