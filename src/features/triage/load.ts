// 実行するフローを DB から読む。サブフローも実行の前にまとめて読む（ランナーを同期的な純粋関数にするため）。
import type { FlowLookup } from "@/features/triage/runner";
import { parseFlow, type Flow } from "@/features/triage/schema";
import { subflowIds } from "@/features/triage/validate";
import type { TriageDetail } from "@/lib/bindings/TriageDetail";

export interface LoadedFlows {
  root: Flow;
  lookup: FlowLookup;
}

/** DB の JSON を読み直す。同期のときに検証済みだが、古い版のアプリが保存した値などに備えて形を確かめる。 */
export function flowOfDetail(detail: TriageDetail): Flow {
  let value: unknown;
  try {
    value = JSON.parse(detail.json);
  } catch {
    throw new Error(`フロー ${detail.id} の JSON を読めません`);
  }
  const result = parseFlow(value);
  if (!result.ok) {
    throw new Error(`フロー ${detail.id} の形が正しくありません: ${result.messages.join(" / ")}`);
  }
  return result.flow;
}

/** ルートのフローと、そこから（入れ子も含めて）呼ばれるサブフローを読む。 */
export async function loadFlowTree(
  id: string,
  get: (id: string) => Promise<TriageDetail>,
): Promise<LoadedFlows> {
  const root = flowOfDetail(await get(id));
  const flows = new Map<string, Flow>([[root.id, root]]);
  const pending = subflowIds(root);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (flows.has(next)) {
      continue;
    }
    const flow = flowOfDetail(await get(next));
    flows.set(flow.id, flow);
    pending.push(...subflowIds(flow));
  }
  return { root, lookup: (flowId) => flows.get(flowId) };
}
