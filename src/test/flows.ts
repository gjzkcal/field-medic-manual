// フローのテスト用の組み立て。validate とランナーのテストで同じ形を使う。
import { FLOW_SCHEMA_ID, type Flow, type FlowNode } from "@/features/triage/schema";

export function makeFlow(
  id: string,
  start: string,
  nodes: Record<string, FlowNode>,
  extra: Partial<Flow> = {},
): Flow {
  return { $schema: FLOW_SCHEMA_ID, id, title: `${id} のタイトル`, start, nodes, ...extra };
}

export function question(text: string, ...nexts: string[]): FlowNode {
  return {
    type: "question",
    text,
    choices: nexts.map((next, i) => ({ label: `選択肢${String(i + 1)}`, next })),
  };
}

export function action(text: string, next: string): FlowNode {
  return { type: "action", text, next };
}

export function end(text: string, outcome: "ok" | "warn" | "critical" = "ok"): FlowNode {
  return { type: "end", text, outcome };
}

export function subflow(flowId: string, next: string): FlowNode {
  return { type: "subflow", flowId, next };
}

/** q1 → (はい) a1 → end / (いいえ) end の正しいフロー。 */
export function simpleFlow(id = "simple"): Flow {
  return makeFlow(id, "q1", {
    q1: question("質問1", "a1", "e-ok"),
    a1: action("処置1", "e-ok"),
    "e-ok": end("安定"),
  });
}

/** 物品を使い、持っていないときの行き先がある action。 */
export function actionWithItems(
  text: string,
  next: string,
  items: string[],
  missingNext: string,
  missingLabel?: string,
): FlowNode {
  return {
    type: "action",
    text,
    next,
    items,
    ifMissing:
      missingLabel === undefined
        ? { next: missingNext }
        : { next: missingNext, label: missingLabel },
  };
}
