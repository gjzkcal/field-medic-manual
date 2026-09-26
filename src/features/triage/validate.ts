// フローのつながりの検証 V1〜V8（dev-docs/reference/triage-format.md §3）。形は schema.ts で確かめ済みの前提。
import type { Flow, FlowNode } from "@/features/triage/schema";

export type IssueCode = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "duplicate";

export interface FlowIssue {
  code: IssueCode;
  /** error のフローは DB に入れない。warning は意図的なら許す（再評価のループなど） */
  level: "error" | "warning";
  message: string;
  /** 問題のあるノード。フロー全体の問題なら null */
  nodeId: string | null;
}

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function hasErrors(issues: readonly FlowIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** ノードから進める先（存在しない行き先も含む）。サブフローは end に着けば next に戻るので next だけを見る。 */
export function nextIds(node: FlowNode): string[] {
  switch (node.type) {
    case "question":
      return node.choices.map((c) => c.next);
    case "action":
      return node.ifMissing === undefined ? [node.next] : [node.next, node.ifMissing.next];
    case "subflow":
      return [node.next];
    case "end":
      return [];
  }
}

/**
 * 1 本のフローを検証する。`flows` はサブフローの行き先（V7）を引くための全フロー（自分を含む）。
 */
export function validateFlow(flow: Flow, flows: ReadonlyMap<string, Flow>): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = new Map(Object.entries(flow.nodes));

  // V8: URL とファイル名に使うため
  if (!SLUG.test(flow.id)) {
    issues.push({
      code: "V8",
      level: "error",
      message: `id「${flow.id}」は英小文字・数字をハイフンでつないだ形にしてください`,
      nodeId: null,
    });
  }

  // V1
  const startExists = nodes.has(flow.start);
  if (!startExists) {
    issues.push({
      code: "V1",
      level: "error",
      message: `start「${flow.start}」が nodes にありません`,
      nodeId: null,
    });
  }

  for (const [id, node] of nodes) {
    // V2
    for (const next of nextIds(node)) {
      if (!nodes.has(next)) {
        issues.push({
          code: "V2",
          level: "error",
          message: `${id} の行き先（next など）「${next}」が nodes にありません`,
          nodeId: id,
        });
      }
    }
    // V3: 1 画面で迷わず押せる数にするため（triage-format.md §1）
    if (
      node.type === "question" &&
      (node.choices.length < MIN_CHOICES || node.choices.length > MAX_CHOICES)
    ) {
      issues.push({
        code: "V3",
        level: "error",
        message: `${id} の選択肢は ${String(MIN_CHOICES)}〜${String(MAX_CHOICES)} 個にしてください（今は ${String(node.choices.length)} 個）`,
        nodeId: id,
      });
    }
    // V7
    if (node.type === "subflow") {
      issues.push(...checkSubflow(flow.id, id, node.flowId, flows));
    }
  }

  const edges = new Map(
    Array.from(nodes, ([id, node]) => [id, nextIds(node).filter((n) => nodes.has(n))]),
  );

  // V4: start がないと到達可能性を決められないので、V1 のエラーだけにする
  if (startExists) {
    const reachable = reachableFrom([flow.start], edges);
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) {
        issues.push({
          code: "V4",
          level: "warning",
          message: `${id} には start からたどり着けません`,
          nodeId: id,
        });
      }
    }
  }

  // V5: end から逆向きにたどれないノードは、どう進んでも end に着かない
  const reverse = new Map<string, string[]>(Array.from(nodes.keys(), (id) => [id, []]));
  for (const [from, tos] of edges) {
    for (const to of tos) {
      reverse.get(to)?.push(from);
    }
  }
  const ends = Array.from(nodes)
    .filter(([, node]) => node.type === "end")
    .map(([id]) => id);
  const canFinish = reachableFrom(ends, reverse);
  for (const id of nodes.keys()) {
    if (!canFinish.has(id)) {
      issues.push({
        code: "V5",
        level: "error",
        message: `${id} からはどの end にもたどり着けません（行き止まり）`,
        nodeId: id,
      });
    }
  }

  // V6: 再評価のループは正常なパターンなので警告にとどめる
  for (const cycle of findCycles(edges)) {
    issues.push({
      code: "V6",
      level: "warning",
      message: `end を通らない循環があります: ${cycle.join(" → ")}（再評価のループなら問題ありません）`,
      nodeId: cycle[0] ?? null,
    });
  }

  return issues;
}

function checkSubflow(
  flowId: string,
  nodeId: string,
  target: string,
  flows: ReadonlyMap<string, Flow>,
): FlowIssue[] {
  if (target === flowId) {
    return [
      {
        code: "V7",
        level: "error",
        message: `${nodeId} が自分自身（${flowId}）をサブフローとして呼んでいます`,
        nodeId,
      },
    ];
  }
  if (!flows.has(target)) {
    return [
      {
        code: "V7",
        level: "error",
        message: `${nodeId} のサブフロー「${target}」がありません`,
        nodeId,
      },
    ];
  }
  // 別のフローを経由して戻ってくる再帰（a → b → a）は、実行すると終わらないのでエラーにする
  const called = reachableFrom(
    [target],
    new Map(Array.from(flows, ([id, f]) => [id, subflowIds(f)])),
  );
  if (called.has(flowId)) {
    return [
      {
        code: "V7",
        level: "error",
        message: `${nodeId} のサブフロー「${target}」から ${flowId} が呼ばれ、再帰になります`,
        nodeId,
      },
    ];
  }
  return [];
}

/** フローがサブフローとして呼ぶフローの id。 */
export function subflowIds(flow: Flow): string[] {
  return Object.values(flow.nodes).flatMap((node) =>
    node.type === "subflow" ? [node.flowId] : [],
  );
}

function reachableFrom(
  starts: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
  return seen;
}

/** 循環（強連結成分のうち 2 ノード以上か、自分に戻るもの）を、ノードの定義順で返す。Tarjan の方法。 */
function findCycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function visit(id: string): void {
    index.set(id, counter);
    low.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
    for (const next of edges.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
        onStack.delete(member);
        component.push(member);
        if (member === id) {
          break;
        }
      }
      if (component.length > 1 || (edges.get(id) ?? []).includes(id)) {
        const order = Array.from(edges.keys());
        cycles.push(component.sort((a, b) => order.indexOf(a) - order.indexOf(b)));
      }
    }
  }

  for (const id of edges.keys()) {
    if (!index.has(id)) {
      visit(id);
    }
  }
  return cycles;
}

/** 同梱した全フローをまとめて検証する。結果は入力と同じ順。 */
export function validateFlows(flows: readonly Flow[]): FlowIssue[][] {
  const counts = new Map<string, number>();
  for (const flow of flows) {
    counts.set(flow.id, (counts.get(flow.id) ?? 0) + 1);
  }
  const byId = new Map(flows.map((f) => [f.id, f]));
  return flows.map((flow) => {
    // 同じ id が 2 つあると、どちらを DB に入れるか決められない
    if ((counts.get(flow.id) ?? 0) > 1) {
      return [
        {
          code: "duplicate",
          level: "error",
          message: `id「${flow.id}」のフローが複数あります`,
          nodeId: null,
        },
      ];
    }
    return validateFlow(flow, byId);
  });
}
