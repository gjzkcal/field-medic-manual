import { describe, expect, it } from "vitest";

import type { FlowchartPayload } from "@/features/content/flowchart";
import {
  edgePath,
  estimateTextWidth,
  layoutFlowchart,
} from "@/features/library/viewer/flowchart-layout";

const PAYLOAD: FlowchartPayload = {
  direction: "TB",
  title: null,
  nodes: [
    { id: "A", shape: "stadium", lines: ["心停止"] },
    { id: "B", shape: "diamond", lines: ["蘇生の判定"] },
    { id: "C", shape: "rect", lines: ["Stable", "に戻る"] },
  ],
  edges: [
    { from: "A", to: "B", dashed: false, lines: [] },
    { from: "B", to: "C", dashed: false, lines: ["成功"] },
    { from: "B", to: "B", dashed: true, lines: [] },
  ],
};

describe("layoutFlowchart", () => {
  const layout = layoutFlowchart(PAYLOAD, estimateTextWidth);

  it("縦向きでは辺の向きに上から下へ並べ、全体がノードを含む", () => {
    const [a, b, c] = layout.nodes;
    expect(a !== undefined && b !== undefined && c !== undefined).toBe(true);
    if (a === undefined || b === undefined || c === undefined) {
      return;
    }
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    for (const n of layout.nodes) {
      expect(n.x - n.width / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height / 2).toBeLessThanOrEqual(layout.height);
    }
    // 2 行の文字のノードは 1 行より高い
    expect(c.height).toBeGreaterThan(a.height);
  });

  it("ラベルのある辺だけにラベルの位置があり、ひし形に入る辺の端はひし形の縁に乗る", () => {
    expect(layout.edges.map((e) => e.label !== null)).toEqual([false, true, false]);
    const b = layout.nodes[1];
    const end = layout.edges[0]?.points.at(-1);
    expect(b !== undefined && end !== undefined).toBe(true);
    if (b === undefined || end === undefined) {
      return;
    }
    const onEdge = Math.abs(end.x - b.x) / (b.width / 2) + Math.abs(end.y - b.y) / (b.height / 2);
    expect(onEdge).toBeCloseTo(1, 5);
  });

  it("横向きでは左から右へ並べる", () => {
    const lr = layoutFlowchart({ ...PAYLOAD, direction: "LR" }, estimateTextWidth);
    const [a, b] = lr.nodes;
    expect((a?.x ?? 0) < (b?.x ?? 0)).toBe(true);
  });
});

describe("edgePath", () => {
  it("2 点は直線、折れ点は曲線で丸める", () => {
    expect(
      edgePath([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe("M0,0 L0,10");
    expect(
      edgePath([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 40, y: 40 },
      ]),
    ).toBe("M0,0 L0,32 Q0,40 8,40 L40,40");
    expect(edgePath([])).toBe("");
  });
});

describe("estimateTextWidth", () => {
  it("全角は 1em、半角は 0.6em で見積もる", () => {
    expect(estimateTextWidth("心停止", 16)).toBe(48);
    expect(estimateTextWidth("CPR", 10)).toBeCloseTo(18);
  });
});
