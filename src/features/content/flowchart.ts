// 原稿のフローチャート。` ```mermaid ` のコードブロックに書いた flowchart を読み、ビューアが描く JSON にする。
// mermaid 本体は使わない（出力にインラインの style と <style> が入り、無害化で落とす方針と合わないため）。
// 書けるのは mermaid の記法のうち、仕組みの流れを描くのに要るものだけ。それ以外は警告にして、誤りに気づけるようにする。
// 変換（コードブロックの置き換え）とビューア（data-flowchart の検証）の両方がここを使う。
import { z } from "zod";

const flowchartNodeSchema = z.strictObject({
  id: z.string().min(1),
  shape: z.enum(["rect", "round", "diamond", "stadium"]),
  lines: z.array(z.string().min(1)).min(1),
});

const flowchartEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  dashed: z.boolean(),
  lines: z.array(z.string().min(1)),
});

export const flowchartPayloadSchema = z
  .strictObject({
    direction: z.enum(["TB", "LR"]),
    // 読み上げ用の題（accTitle）
    title: z.string().nullable(),
    nodes: z.array(flowchartNodeSchema).min(1),
    edges: z.array(flowchartEdgeSchema).min(1),
  })
  .refine((payload) => {
    const ids = new Set(payload.nodes.map((n) => n.id));
    return (
      ids.size === payload.nodes.length &&
      payload.edges.every((e) => ids.has(e.from) && ids.has(e.to))
    );
  });

export type FlowchartPayload = z.infer<typeof flowchartPayloadSchema>;
export type FlowchartNode = z.infer<typeof flowchartNodeSchema>;
export type FlowchartEdge = z.infer<typeof flowchartEdgeSchema>;
type Shape = FlowchartNode["shape"];

const HEADER = /^(?:flowchart|graph)\s+(\S+)$/;
const DIRECTIONS: Record<string, FlowchartPayload["direction"]> = { TD: "TB", TB: "TB", LR: "LR" };
const ACC_TITLE = /^accTitle\s*:\s*(.*)$/;
const UNSUPPORTED_KEYWORDS = new Set([
  "subgraph",
  "end",
  "classDef",
  "class",
  "style",
  "linkStyle",
  "click",
  "direction",
  "accDescr",
]);
const NODE_ID = /^[A-Za-z0-9_]+/;
// 長い開きを先に試す（`([` を `(` と読まないため）
const SHAPES: { open: string; close: string; shape: Shape }[] = [
  { open: "([", close: "])", shape: "stadium" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
];
// 引用符なしの文字にこれらがあると、mermaid と読み方が食い違う（GitHub で別の図になる）ので引用符を求める
const RESERVED_IN_TEXT = /[[\](){}"|]/;
const LINE_BREAK = /<br\s*\/?>/i;

class FlowchartError extends Error {}

interface NodeDraft {
  shape: Shape;
  lines: string[];
  /** 文字を付けて定義したか。id だけの参照なら false */
  defined: boolean;
}

/** コードブロックの中身を読む。記法の誤りや使えない記法は error（何行目かを付ける）。 */
export function parseFlowchart(
  text: string,
): { payload: FlowchartPayload } | { error: string } {
  const lines = text.split(/\r?\n/);
  let direction: FlowchartPayload["direction"] | null = null;
  let title: string | null = null;
  const nodes = new Map<string, NodeDraft>();
  const edges: FlowchartEdge[] = [];

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) {
      continue;
    }
    const at = `${String(index + 1)} 行目`;
    if (direction === null) {
      const header = HEADER.exec(line.replace(/;$/, ""));
      const value = header?.[1];
      if (value === undefined) {
        return { error: `${at}: 1 行目は「flowchart TD」か「flowchart LR」にしてください` };
      }
      const resolved = DIRECTIONS[value];
      if (resolved === undefined) {
        return { error: `${at}: 向き「${value}」は使えません（TD / TB / LR）` };
      }
      direction = resolved;
      continue;
    }
    const acc = ACC_TITLE.exec(line);
    if (acc !== null) {
      const value = (acc[1] ?? "").trim();
      if (value === "") {
        return { error: `${at}: accTitle の文字が空です` };
      }
      title = value;
      continue;
    }
    // 語の後ろまで見る（`classA` のような id を `class` と取り違えないため）
    const keyword = /^([A-Za-z]+)(?=[\s:{]|$)/.exec(line)?.[1];
    if (keyword !== undefined && UNSUPPORTED_KEYWORDS.has(keyword)) {
      return { error: `${at}: 「${keyword}」は使えません` };
    }
    try {
      for (const statement of splitStatements(line)) {
        parseStatement(statement, nodes, edges);
      }
    } catch (error: unknown) {
      if (error instanceof FlowchartError) {
        return { error: `${at}: ${error.message}` };
      }
      throw error;
    }
  }

  if (direction === null) {
    return { error: "「flowchart TD」の行がありません" };
  }
  if (edges.length === 0) {
    return { error: "辺（-->）がありません" };
  }
  return {
    payload: {
      direction,
      title,
      nodes: Array.from(nodes, ([id, node]) => ({ id, shape: node.shape, lines: node.lines })),
      edges,
    },
  };
}

/** `;` で 1 行を文に分ける。引用符の中の `;` は区切りにしない。 */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
    }
    if (ch === ";" && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/** `A[文字] -->|ラベル| B --> C` のような、ノードと辺が交互に並ぶ 1 文を読む。 */
function parseStatement(
  statement: string,
  nodes: Map<string, NodeDraft>,
  edges: FlowchartEdge[],
): void {
  let rest = statement;
  let from = readNode();
  while (rest !== "") {
    const edge = readEdge();
    const to = readNode();
    edges.push({ from, to, ...edge });
    from = to;
  }

  function readNode(): string {
    rest = rest.trimStart();
    const id = NODE_ID.exec(rest)?.[0];
    if (id === undefined) {
      throw new FlowchartError(`ノードの id（英数字と _）が要る所に「${rest}」があります`);
    }
    rest = rest.slice(id.length);
    const spec = SHAPES.find((s) => rest.startsWith(s.open));
    if (spec === undefined) {
      if (!nodes.has(id)) {
        // mermaid と同じく、文字のない id だけのノードは id を文字にする
        nodes.set(id, { shape: "rect", lines: [id], defined: false });
      }
      return id;
    }
    rest = rest.slice(spec.open.length);
    const label = readText(spec.close);
    const lines = splitLines(label);
    if (lines.length === 0) {
      throw new FlowchartError(`ノード「${id}」の文字が空です`);
    }
    const existing = nodes.get(id);
    if (
      existing?.defined === true &&
      (existing.shape !== spec.shape || existing.lines.join("\n") !== lines.join("\n"))
    ) {
      throw new FlowchartError(`ノード「${id}」に違う文字か形が付いています`);
    }
    nodes.set(id, { shape: spec.shape, lines, defined: true });
    return id;
  }

  /** 閉じの記号までの文字。引用符で囲めば記号も文字にできる。 */
  function readText(close: string): string {
    if (rest.startsWith('"')) {
      const end = rest.indexOf('"', 1);
      if (end === -1) {
        throw new FlowchartError("引用符が閉じていません");
      }
      const text = rest.slice(1, end);
      rest = rest.slice(end + 1);
      if (!rest.startsWith(close)) {
        throw new FlowchartError(`引用符の後に「${close}」がありません`);
      }
      rest = rest.slice(close.length);
      return text;
    }
    const end = rest.indexOf(close);
    if (end === -1) {
      throw new FlowchartError(`「${close}」が閉じていません`);
    }
    const text = rest.slice(0, end);
    if (RESERVED_IN_TEXT.test(text)) {
      throw new FlowchartError(`記号を含む文字「${text}」は引用符で囲んでください`);
    }
    rest = rest.slice(end + close.length);
    return text;
  }

  function readEdge(): { dashed: boolean; lines: string[] } {
    rest = rest.trimStart();
    // `-- 文字 -->` / `-. 文字 .->`（文字を矢印の間に書く形）
    const inline = /^(--|-\.)\s+(.+?)\s+(-->|\.->)/.exec(rest);
    if (inline !== null) {
      const dashed = inline[1] === "-.";
      if ((inline[3] === ".->") !== dashed) {
        throw new FlowchartError(`矢印「${inline[0]}」の始まりと終わりが合っていません`);
      }
      const text = inline[2] ?? "";
      if (RESERVED_IN_TEXT.test(text)) {
        throw new FlowchartError(`記号を含む文字「${text}」は「-->|"…"|」の形で書いてください`);
      }
      rest = rest.slice(inline[0].length);
      return { dashed, lines: splitLines(text) };
    }
    const arrow = ["-->", "-.->"].find((a) => rest.startsWith(a));
    if (arrow === undefined) {
      throw new FlowchartError(`使えない矢印か記法です: 「${rest}」（--> と -.-> だけ）`);
    }
    rest = rest.slice(arrow.length).trimStart();
    let lines: string[] = [];
    if (rest.startsWith("|")) {
      rest = rest.slice(1);
      lines = splitLines(readText("|"));
    }
    return { dashed: arrow === "-.->", lines };
  }
}

function splitLines(text: string): string[] {
  return text
    .split(LINE_BREAK)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

/**
 * `pre > code.language-mermaid` を `figure[data-flowchart]` に置き換える。
 * figure の中には辺を 1 つずつ文にしたリストを入れる。ビューアは図を描いたらこれを画面から隠すが、
 * 検索の本文と読み上げにはこれを使う（図の文字は SVG の中にあり、どちらにも載らないため）。
 * 書き間違いは警告にして、コードブロックのまま残す（同梱の原稿は警告 0 を検査しているので、誤りに気づける）。
 */
export function markFlowcharts(body: HTMLElement, warnings: string[]): void {
  for (const code of Array.from(body.querySelectorAll("pre > code.language-mermaid"))) {
    const pre = code.parentElement;
    if (pre === null) {
      continue;
    }
    const parsed = parseFlowchart(code.textContent);
    if ("error" in parsed) {
      warnings.push(`フローチャートを読めませんでした: ${parsed.error}`);
      continue;
    }
    pre.replaceWith(flowchartFigure(body.ownerDocument, parsed.payload));
  }
}

function flowchartFigure(doc: Document, payload: FlowchartPayload): HTMLElement {
  const figure = doc.createElement("figure");
  figure.setAttribute("data-flowchart", JSON.stringify(payload));
  if (payload.title !== null) {
    figure.setAttribute("aria-label", payload.title);
  }
  const label = new Map(payload.nodes.map((n) => [n.id, n.lines.join(" ")]));
  const list = doc.createElement("ul");
  list.className = "manual-flowchart-text";
  const linked = new Set<string>();
  for (const edge of payload.edges) {
    linked.add(edge.from).add(edge.to);
    const note = edge.lines.length > 0 ? `（${edge.lines.join(" ")}）` : "";
    const item = doc.createElement("li");
    item.textContent = `${label.get(edge.from) ?? edge.from} → ${label.get(edge.to) ?? edge.to}${note}`;
    list.append(item);
  }
  // 辺のないノードも、文字が検索に載るよう 1 行にする
  for (const node of payload.nodes) {
    if (!linked.has(node.id)) {
      const item = doc.createElement("li");
      item.textContent = node.lines.join(" ");
      list.append(item);
    }
  }
  figure.append(list);
  return figure;
}

/** figure に付けた `data-flowchart` を読む。DB の中身を書き換えられた場合に備え、形を確かめてから使う。 */
export function readFlowchartPayload(json: string): FlowchartPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const result = flowchartPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}
