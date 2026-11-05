// フローの各ノードが TCCC・MARCH PAWS のどこに当たるかの表示。文字だけでは読めない人もいるので意味を添える。
import type { Flow, FlowNode, MarchStep } from "@/features/triage/schema";

export const MARCH_LABELS: Record<MarchStep, string> = {
  cuf: "CUF/T 脅威下",
  m: "M 大出血",
  a: "A 気道",
  r: "R 呼吸",
  c: "C 循環",
  cpr: "CPR",
  p: "P 痛み",
  w: "W 傷",
  s: "S 副子固定",
};

/** ノードに当たる文字。ノードに書いてあればそれ、なければフロー全体の march（文字ごとのサブフローで 1 回だけ書くため）。 */
export function marchOf(flow: Flow, node: FlowNode): readonly MarchStep[] {
  if (node.type === "subflow" || node.type === "branch") {
    return [];
  }
  return node.march ?? flow.march ?? [];
}
