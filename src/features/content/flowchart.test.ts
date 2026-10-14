import { describe, expect, it } from "vitest";

import {
  markFlowcharts,
  parseFlowchart,
  readFlowchartPayload,
  type FlowchartPayload,
} from "@/features/content/flowchart";

function parsed(text: string): FlowchartPayload {
  const result = parseFlowchart(text);
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result.payload;
}

function errorOf(text: string): string {
  const result = parseFlowchart(text);
  return "error" in result ? result.error : "";
}

describe("parseFlowchart", () => {
  it("向き・題・ノードの形・辺の種類とラベルを読む", () => {
    const payload = parsed(
      [
        "flowchart TD",
        "  %% コメントは飛ばす",
        "  accTitle: 血液と状態",
        "  S([Stable]) -->|血液 70% 未満| U[Unstable]",
        "  U -- 血液 40% 以下 --> C{Critical}",
        "  C -.-> D(死亡)",
        "  C -. 回復 .-> U;",
      ].join("\n"),
    );
    expect(payload).toEqual({
      direction: "TB",
      title: "血液と状態",
      nodes: [
        { id: "S", shape: "stadium", lines: ["Stable"] },
        { id: "U", shape: "rect", lines: ["Unstable"] },
        { id: "C", shape: "diamond", lines: ["Critical"] },
        { id: "D", shape: "round", lines: ["死亡"] },
      ],
      edges: [
        { from: "S", to: "U", dashed: false, lines: ["血液 70% 未満"] },
        { from: "U", to: "C", dashed: false, lines: ["血液 40% 以下"] },
        { from: "C", to: "D", dashed: true, lines: [] },
        { from: "C", to: "U", dashed: true, lines: ["回復"] },
      ],
    });
  });

  it("連結・graph・LR・; の区切り・引用符・<br>・id だけのノードを読む", () => {
    const payload = parsed(
      'graph LR\nA["心停止（Circulation）<br/>[脈なし]"] --> B --> C; C-->A\nB[CPR<br>開始]',
    );
    expect(payload.direction).toBe("LR");
    expect(payload.nodes).toEqual([
      { id: "A", shape: "rect", lines: ["心停止（Circulation）", "[脈なし]"] },
      { id: "B", shape: "rect", lines: ["CPR", "開始"] },
      { id: "C", shape: "rect", lines: ["C"] },
    ]);
    expect(payload.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["A>B", "B>C", "C>A"]);
  });

  it("書き間違いと使えない記法は行番号付きのエラーにする", () => {
    expect(errorOf("A --> B")).toBe("1 行目: 1 行目は「flowchart TD」か「flowchart LR」にしてください");
    expect(errorOf("flowchart RL\nA --> B")).toBe("1 行目: 向き「RL」は使えません（TD / TB / LR）");
    expect(errorOf("flowchart TD\nsubgraph X\nA --> B\nend")).toBe("2 行目: 「subgraph」は使えません");
    expect(errorOf("flowchart TD\nA --> B\nstyle A fill:#f00")).toBe("3 行目: 「style」は使えません");
    expect(errorOf("flowchart TD\nA ==> B")).toContain("2 行目: 使えない矢印か記法です");
    expect(errorOf("flowchart TD\nA & B --> C")).toContain("使えない矢印か記法です");
    expect(errorOf("flowchart TD\nA[(DB)] --> B")).toContain("引用符で囲んでください");
    expect(errorOf("flowchart TD\nA[開く --> B")).toContain("「]」が閉じていません");
    expect(errorOf('flowchart TD\nA["開く] --> B')).toContain("引用符が閉じていません");
    expect(errorOf("flowchart TD\nA[] --> B")).toContain("ノード「A」の文字が空です");
    expect(errorOf("flowchart TD\nA[一] --> B\nA[二] --> C")).toContain(
      "ノード「A」に違う文字か形が付いています",
    );
    expect(errorOf("flowchart TD\nA -- 文字 .-> B")).toContain("始まりと終わりが合っていません");
    expect(errorOf("flowchart TD\nA[だけ]")).toBe("辺（-->）がありません");
    expect(errorOf("flowchart TD\naccTitle:\nA --> B")).toBe("2 行目: accTitle の文字が空です");
  });

  it("class で始まる id は記法の語と取り違えない", () => {
    expect(parsed("flowchart TD\nclassA --> endB").nodes.map((n) => n.id)).toEqual([
      "classA",
      "endB",
    ]);
  });

  it("同じノードを同じ文字で定義し直すのは許す", () => {
    expect(parsed("flowchart TD\nA[一] --> B\nA[一] --> C").nodes).toHaveLength(3);
  });
});

describe("markFlowcharts", () => {
  function body(html: string): HTMLElement {
    return new DOMParser().parseFromString(html, "text/html").body;
  }

  it("mermaid のコードブロックを figure にし、辺を文にしたリストを入れる", () => {
    const root = body(
      '<pre><code class="language-mermaid">flowchart TD\naccTitle: 流れ\nA[始め] --&gt;|条件| B[終わり]\nC[離れた]  --&gt; C\n</code></pre>',
    );
    const warnings: string[] = [];
    markFlowcharts(root, warnings);

    expect(warnings).toEqual([]);
    const figure = root.querySelector("figure[data-flowchart]");
    expect(figure?.getAttribute("aria-label")).toBe("流れ");
    expect(readFlowchartPayload(figure?.getAttribute("data-flowchart") ?? "")?.edges).toHaveLength(2);
    expect(Array.from(figure?.querySelectorAll("li") ?? [], (li) => li.textContent)).toEqual([
      "始め → 終わり（条件）",
      "離れた → 離れた",
    ]);
    expect(root.querySelector("pre")).toBeNull();
  });

  it("書き間違いは警告にしてコードブロックのまま残し、ほかの言語のコードは触らない", () => {
    const root = body(
      '<pre><code class="language-mermaid">flowchart TD\nA ==&gt; B</code></pre><pre><code class="language-js">a --&gt; b</code></pre>',
    );
    const warnings: string[] = [];
    markFlowcharts(root, warnings);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("フローチャートを読めませんでした: 2 行目");
    expect(root.querySelectorAll("pre")).toHaveLength(2);
    expect(root.querySelector("figure")).toBeNull();
  });
});

describe("readFlowchartPayload", () => {
  const valid: FlowchartPayload = {
    direction: "TB",
    title: null,
    nodes: [
      { id: "A", shape: "rect", lines: ["a"] },
      { id: "B", shape: "rect", lines: ["b"] },
    ],
    edges: [{ from: "A", to: "B", dashed: false, lines: [] }],
  };

  it("正しい形だけを受け取る", () => {
    expect(readFlowchartPayload(JSON.stringify(valid))).toEqual(valid);
    expect(readFlowchartPayload("{")).toBeNull();
    expect(readFlowchartPayload(JSON.stringify({ ...valid, extra: 1 }))).toBeNull();
    expect(
      readFlowchartPayload(
        JSON.stringify({ ...valid, edges: [{ from: "A", to: "X", dashed: false, lines: [] }] }),
      ),
    ).toBeNull();
    expect(
      readFlowchartPayload(JSON.stringify({ ...valid, nodes: [...valid.nodes, valid.nodes[0]] })),
    ).toBeNull();
  });
});
