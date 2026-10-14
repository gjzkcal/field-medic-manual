// フローチャートの配置。dagre でノードと辺の位置を決める。
// 長さの単位は「文字 16px のときの px」。SVG の viewBox をこの単位にし、幅を em で指定すると、文字サイズの設定に図ごと追従する。
import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";

import type { FlowchartNode, FlowchartPayload } from "@/features/content/flowchart";

export const FONT_SIZE = 16;
export const LINE_HEIGHT = 22;
export const EDGE_FONT_SIZE = 14;
export const EDGE_LINE_HEIGHT = 19;
const PAD_X = 12;
const PAD_Y = 8;
const EDGE_LABEL_PAD_X = 4;
const EDGE_LABEL_PAD_Y = 2;
// 線と枠の太さの分だけ外側に余白を取り、端のノードの枠が切れないようにする
const MARGIN = 2;

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode {
  node: FlowchartNode;
  /** 中心 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedEdge {
  dashed: boolean;
  lines: string[];
  points: Point[];
  /** ラベルの中心と大きさ。ラベルがなければ null */
  label: { x: number; y: number; width: number; height: number } | null;
}

export interface FlowchartLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

export type MeasureText = (text: string, fontSize: number) => number;

export function layoutFlowchart(payload: FlowchartPayload, measure: MeasureText): FlowchartLayout {
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
  graph.setGraph({
    rankdir: payload.direction,
    nodesep: 28,
    ranksep: 36,
    edgesep: 16,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  for (const node of payload.nodes) {
    graph.setNode(node.id, nodeSize(node, measure));
  }
  payload.edges.forEach((edge, i) => {
    const size =
      edge.lines.length === 0
        ? { width: 0, height: 0 }
        : textBox(
            edge.lines,
            EDGE_FONT_SIZE,
            EDGE_LINE_HEIGHT,
            measure,
            EDGE_LABEL_PAD_X,
            EDGE_LABEL_PAD_Y,
          );
    graph.setEdge(edge.from, edge.to, { ...size, labelpos: "c" }, `e${String(i)}`);
  });
  dagre.layout(graph);

  const nodes = payload.nodes.map((node): PlacedNode => {
    const placed = graph.node(node.id);
    return { node, x: placed.x ?? 0, y: placed.y ?? 0, width: placed.width, height: placed.height };
  });
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const edges = payload.edges.map((edge, i): PlacedEdge => {
    const placed = graph.edge(edge.from, edge.to, `e${String(i)}`);
    const points = clipEnds(placed.points ?? [], byId.get(edge.from), byId.get(edge.to));
    const hasLabel = edge.lines.length > 0 && placed.x !== undefined && placed.y !== undefined;
    return {
      dashed: edge.dashed,
      lines: edge.lines,
      points,
      label: hasLabel
        ? {
            x: placed.x ?? 0,
            y: placed.y ?? 0,
            width: placed.width ?? 0,
            height: placed.height ?? 0,
          }
        : null,
    };
  });
  const size = graph.graph();
  return { width: size.width ?? 0, height: size.height ?? 0, nodes, edges };
}

function textBox(
  lines: string[],
  fontSize: number,
  lineHeight: number,
  measure: MeasureText,
  padX: number,
  padY: number,
): { width: number; height: number } {
  const textWidth = Math.max(...lines.map((line) => measure(line, fontSize)));
  return { width: Math.ceil(textWidth) + padX * 2, height: lines.length * lineHeight + padY * 2 };
}

function nodeSize(node: FlowchartNode, measure: MeasureText): { width: number; height: number } {
  const box = textBox(node.lines, FONT_SIZE, LINE_HEIGHT, measure, PAD_X, PAD_Y);
  switch (node.shape) {
    case "diamond": {
      // 文字の箱（幅 w・高さ h）の角がひし形の辺に乗る大きさ。半分の対角線を w/2·(1+r)、h/2·(1+1/r) にすると、
      // どの r でも角が辺に乗る。r = √(h/w) にすると、正方形のひし形（r = h/w）ほど横長の文字で大きくならない
      const w = box.width - PAD_X;
      const h = box.height - PAD_Y;
      const r = Math.sqrt(h / w);
      return { width: Math.ceil(w * (1 + r)), height: Math.ceil(h * (1 + 1 / r)) };
    }
    case "stadium":
      // 両端の半円の分、文字が丸みにかからないよう幅を足す
      return { width: box.width + box.height / 2, height: box.height };
    case "rect":
    case "round":
      return box;
  }
}

/**
 * dagre は辺の端をノードを囲む四角の縁で止めるので、ひし形では角の外で止まって矢印が浮く。
 * ひし形の端は、隣の点からノードの中心へ向かう線とひし形の縁の交点に置き直す。
 */
function clipEnds(
  points: Point[],
  from: PlacedNode | undefined,
  to: PlacedNode | undefined,
): Point[] {
  if (points.length < 2) {
    return points;
  }
  const out = [...points];
  const second = out[1];
  const beforeLast = out[out.length - 2];
  if (from?.node.shape === "diamond" && second !== undefined) {
    out[0] = diamondEdge(from, second);
  }
  if (to?.node.shape === "diamond" && beforeLast !== undefined) {
    out[out.length - 1] = diamondEdge(to, beforeLast);
  }
  return out;
}

function diamondEdge(node: PlacedNode, toward: Point): Point {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const scale = Math.abs(dx) / halfW + Math.abs(dy) / halfH;
  if (scale === 0) {
    return { x: node.x, y: node.y };
  }
  return { x: node.x + dx / scale, y: node.y + dy / scale };
}

/** 折れ線の角を丸めた path。dagre の点は折れ線なので、角だけを短い曲線にする。 */
export function edgePath(points: Point[]): string {
  const [first, ...rest] = points;
  if (first === undefined) {
    return "";
  }
  const parts = [`M${fmt(first.x)},${fmt(first.y)}`];
  for (let i = 0; i < rest.length; i++) {
    const current = rest[i];
    const prev = i === 0 ? first : rest[i - 1];
    const next = rest[i + 1];
    if (current === undefined || prev === undefined) {
      continue;
    }
    if (next === undefined) {
      parts.push(`L${fmt(current.x)},${fmt(current.y)}`);
      continue;
    }
    const radius = Math.min(8, distance(prev, current) / 2, distance(current, next) / 2);
    const enter = toward(current, prev, radius);
    const leave = toward(current, next, radius);
    parts.push(
      `L${fmt(enter.x)},${fmt(enter.y)}`,
      `Q${fmt(current.x)},${fmt(current.y)} ${fmt(leave.x)},${fmt(leave.y)}`,
    );
  }
  return parts.join(" ");
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** from から to へ length だけ進んだ点。 */
function toward(from: Point, to: Point, length: number): Point {
  const d = distance(from, to);
  if (d === 0) {
    return from;
  }
  return { x: from.x + ((to.x - from.x) * length) / d, y: from.y + ((to.y - from.y) * length) / d };
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * 文字の幅の見積もり。キャンバスで測れない環境（テスト）で使う。
 * 全角（CJK・全角の記号）は 1 文字 1em、それ以外は 0.6em とみなす。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    em += code >= 0x2e80 || (code >= 0x2190 && code <= 0x21ff) ? 1 : 0.6;
  }
  return em * fontSize;
}
