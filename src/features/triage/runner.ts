// トリアージの実行の状態機械。状態は「ルートのフローの start から、どの選択肢を選んだか」の番号の列だけで表し、
// 毎回それを再生して作る（URL の ?path= に載せて小窓とメイン画面で引き継ぐため。dev-docs/reference/triage-format.md §4）。
import type { ActionNode, ChoiceTone, EndNode, Flow, QuestionNode } from "@/features/triage/schema";

export type FlowLookup = (id: string) => Flow | undefined;

/** 画面に出すノード。subflow は入った時点でサブフローの start に置き換わるので出てこない。 */
export type ShownNode = QuestionNode | ActionNode | EndNode;

export interface RunnerOption {
  label: string;
  tone: ChoiceTone | null;
}

/** たどった経路の 1 歩（パンくず）。 */
export interface TrailStep {
  flowId: string;
  flowTitle: string;
  nodeId: string;
  text: string;
  /** 選んだ選択肢（action なら「次へ」） */
  answer: string;
  /** サブフローの深さ。0 = ルートのフロー */
  depth: number;
}

export interface RunnerState {
  /** 今のノードがあるフロー（サブフローの中ならサブフロー） */
  flow: Flow;
  nodeId: string;
  node: ShownNode;
  depth: number;
  /** 再生できた経路。URL の経路が途中で無効になっていれば、その手前まで */
  path: number[];
  trail: TrailStep[];
  /** 今のノードで選べるもの。番号がそのまま経路の値になる。ルートの end では空 */
  options: RunnerOption[];
}

export const NEXT_LABEL = "次へ";
/** action の ifMissing の既定の文言。物品の名前をつなぐ */
export function missingLabel(node: ActionNode): string {
  if (node.ifMissing?.label !== undefined) {
    return node.ifMissing.label;
  }
  const items = node.items ?? [];
  return items.length === 0 ? "物品を持っていない" : `${items.join("・")}を持っていない`;
}
export const RETURN_LABEL = "元のフローへ戻る";
/** 検証（V7）で再帰は弾いているが、DB が同梱物とずれた場合に無限に潜らないための上限 */
const MAX_DEPTH = 16;

interface Frame {
  flow: Flow;
  /** サブフローが end に着いたときに戻る先 */
  returnTo: string;
}

interface Position {
  flow: Flow;
  nodeId: string;
  node: ShownNode;
  stack: Frame[];
}

/**
 * フロー `flow` のノード `nodeId` に移る。subflow ならサブフローの start へ入る（start が subflow でも続けて入る）。
 * フローの形の誤り（存在しないノードやフロー）は、読み込みと検証で先に弾いている前提なので例外にする。
 */
function arrive(flow: Flow, nodeId: string, stack: Frame[], lookup: FlowLookup): Position {
  let current = flow;
  let id = nodeId;
  let frames = stack;
  for (;;) {
    const node = current.nodes[id];
    if (node === undefined) {
      throw new Error(`フロー ${current.id} にノード ${id} がありません`);
    }
    if (node.type !== "subflow") {
      return { flow: current, nodeId: id, node, stack: frames };
    }
    const child = lookup(node.flowId);
    if (child === undefined) {
      throw new Error(`サブフロー ${node.flowId} が読み込まれていません`);
    }
    if (frames.length >= MAX_DEPTH) {
      throw new Error(`サブフローが深すぎます（${node.flowId}）`);
    }
    frames = [...frames, { flow: current, returnTo: node.next }];
    current = child;
    id = child.start;
  }
}

function optionsOf(position: Position): RunnerOption[] {
  switch (position.node.type) {
    case "question":
      return position.node.choices.map((c) => ({ label: c.label, tone: c.tone ?? null }));
    case "action":
      return position.node.ifMissing === undefined
        ? [{ label: NEXT_LABEL, tone: null }]
        : [
            { label: NEXT_LABEL, tone: null },
            { label: missingLabel(position.node), tone: null },
          ];
    case "end":
      return position.stack.length > 0 ? [{ label: RETURN_LABEL, tone: null }] : [];
  }
}

/** 選択肢 `choice` を選んだ次の位置。選べない番号なら null。 */
function step(position: Position, choice: number, lookup: FlowLookup): Position | null {
  const { node, flow, stack } = position;
  switch (node.type) {
    case "question": {
      const picked = node.choices[choice];
      return picked === undefined ? null : arrive(flow, picked.next, stack, lookup);
    }
    case "action":
      if (choice === 0) {
        return arrive(flow, node.next, stack, lookup);
      }
      return choice === 1 && node.ifMissing !== undefined
        ? arrive(flow, node.ifMissing.next, stack, lookup)
        : null;
    case "end": {
      const frame = stack.at(-1);
      if (choice !== 0 || frame === undefined) {
        return null;
      }
      return arrive(frame.flow, frame.returnTo, stack.slice(0, -1), lookup);
    }
  }
}

/** ルートのフロー `root` を経路 `path` のとおりに進めた状態。 */
export function replay(root: Flow, lookup: FlowLookup, path: readonly number[]): RunnerState {
  let position = arrive(root, root.start, [], lookup);
  const trail: TrailStep[] = [];
  const valid: number[] = [];
  for (const choice of path) {
    const options = optionsOf(position);
    const next = step(position, choice, lookup);
    const answer = options[choice]?.label;
    if (next === null || answer === undefined) {
      break;
    }
    trail.push({
      flowId: position.flow.id,
      flowTitle: position.flow.title,
      nodeId: position.nodeId,
      text: position.node.text,
      answer,
      depth: position.stack.length,
    });
    valid.push(choice);
    position = next;
  }
  return {
    flow: position.flow,
    nodeId: position.nodeId,
    node: position.node,
    depth: position.stack.length,
    path: valid,
    trail,
    options: optionsOf(position),
  };
}

/** URL の `?path=0.1.0` を番号の列にする。数でない部分から先は捨てる（手で書き換えられた URL でも落ちないため）。 */
export function parsePath(text: string | null): number[] {
  const path: number[] = [];
  if (text === null || text === "") {
    return path;
  }
  for (const part of text.split(".")) {
    if (!/^\d+$/.test(part)) {
      break;
    }
    path.push(Number(part));
  }
  return path;
}

export function formatPath(path: readonly number[]): string {
  return path.join(".");
}
