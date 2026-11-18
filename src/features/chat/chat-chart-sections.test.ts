import { describe, expect, it } from "vitest";

import { sectionPart, type SectionScope } from "@/features/chat/chat-chart-sections";
import type { ChartPart } from "@/features/chat/chat-chart";
import type { ChartPayload } from "@/features/content/chart";
import type { ChartSection } from "@/lib/bindings/ChartSection";

const SOURCE = "doc:oxygen-mask.md#効果";

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** 変換が表や figure に付けるのと同じ形の `data-chart`。 */
function chartAttribute(payload: ChartPayload): string {
  return `data-chart="${escapeAttribute(JSON.stringify(payload))}"`;
}

const MASK: ChartPayload = {
  spec: {
    x: "経過",
    y: ["SpO2"],
    y2: ["肺の酸素"],
    ref: [],
    title: null,
    data: "data/oxygen-mask.csv",
    unit: null,
  },
  data: {
    xLabel: "経過",
    xUnit: "s",
    series: [
      { key: "s0", label: "SpO2", panel: "y", unit: "%" },
      { key: "s1", label: "肺の酸素", panel: "y2", unit: "kPa" },
    ],
    points: [
      { x: 0, values: { s0: 97.15, s1: 13.3 } },
      { x: 10, values: { s0: 98.05 } },
      { x: 20, values: { s0: 98.6, s1: 40.1 } },
    ],
  },
};

const CONCENTRATION: ChartPayload = {
  spec: { x: "経過", y: ["濃度"], y2: [], ref: [], title: null, data: "data/x.csv", unit: "nM" },
  data: {
    xLabel: "経過",
    xUnit: "s",
    series: [{ key: "s0", label: "濃度", panel: "y", unit: "nM" }],
    points: [
      { x: 0, values: { s0: 0 } },
      { x: 5, values: { s0: 120 } },
    ],
  },
};

const PLAIN_TABLE = `<table><thead><tr><th>血液</th><th>心拍数</th><th>状態</th></tr></thead>
<tbody><tr><td>100%</td><td>80 bpm</td><td>正常</td></tr><tr><td>80%</td><td>110 bpm</td><td>頻脈</td></tr>
<tr><td>60%</td><td>140 bpm</td><td>—</td></tr></tbody></table>`;

function scope(...htmls: string[]): SectionScope {
  return { docId: "doc-mask", docTitle: "酸素マスク", anchor: "効果", title: "効果", htmls };
}

function target(lines: string[] = [], x = ""): ChartSection {
  return { source: SOURCE, x, lines };
}

function part(value: ChartPart | string): ChartPart {
  if (typeof value === "string") {
    throw new TypeError(`作れるはず: ${value}`);
  }
  return value;
}

describe("節のグラフ", () => {
  const html = `<p>説明</p><table ${chartAttribute(MASK)}><tbody></tbody></table>`;

  it("線を指定しなければ、節のグラフの線を全部、値をそのまま取る", () => {
    const made = part(sectionPart(target(), scope(html)));
    expect(made.lines).toStrictEqual([
      {
        label: "SpO2（酸素マスク）",
        axis: "unit:%",
        unit: "%",
        xLabel: "経過",
        xUnit: "s",
        points: [
          { x: 0, y: 97.15 },
          { x: 10, y: 98.05 },
          { x: 20, y: 98.6 },
        ],
      },
      {
        label: "肺の酸素（酸素マスク）",
        axis: "unit:kPa",
        unit: "kPa",
        xLabel: "経過",
        xUnit: "s",
        // 値のない点は飛ばす
        points: [
          { x: 0, y: 13.3 },
          { x: 20, y: 40.1 },
        ],
      },
    ]);
    expect(made.condition).toBe("原稿「酸素マスク > 効果」のグラフの線: SpO2、肺の酸素");
    expect(made.source).toStrictEqual({
      title: "酸素マスク > 効果",
      docId: "doc-mask",
      anchor: "効果",
    });
  });

  it("名前で線を選べる（凡例の「名前（単位）」の形でも）", () => {
    expect(
      part(sectionPart(target(["肺の酸素"]), scope(html))).lines.map((l) => l.label),
    ).toStrictEqual(["肺の酸素（酸素マスク）"]);
    expect(part(sectionPart(target(["SpO2（%）"]), scope(html))).lines).toHaveLength(1);
  });

  it("配下の節にある、表のないグラフも探す", () => {
    const child = `<figure ${chartAttribute(CONCENTRATION)}></figure>`;
    const made = part(sectionPart(target(["濃度"]), scope("<p>親の節</p>", child)));
    expect(made.lines[0]).toMatchObject({ label: "濃度（酸素マスク）", axis: "unit:nM" });
  });

  it("ない線は、使える線の名前と表の列を添えて理由を返す", () => {
    const message = sectionPart(target(["血圧"]), scope(html, PLAIN_TABLE));
    expect(message).toContain("「血圧」という線はありません。この節のグラフの線: SpO2、肺の酸素。");
    expect(message).toContain("グラフになっていない表の列: [血液, 心拍数, 状態]");
  });

  it("グラフのない節と、形の壊れた data-chart は理由を返す", () => {
    expect(sectionPart(target(), scope("<p>文だけ</p>"))).toBe(`${SOURCE} にグラフがありません。`);
    expect(sectionPart(target(), scope(`<table data-chart="{}"></table>`))).toContain(
      "グラフがありません",
    );
  });
});

describe("グラフになっていない表", () => {
  it("横軸と縦の列を指定すると、セルの値から線を作る", () => {
    const made = part(sectionPart(target(["心拍数"], "血液"), scope("<p>前</p>", PLAIN_TABLE)));
    expect(made.lines).toStrictEqual([
      {
        label: "心拍数（酸素マスク）",
        axis: "unit:bpm",
        unit: "bpm",
        xLabel: "血液",
        xUnit: "%",
        // 表は血液の多い順に並んでいるが、線の点は横軸の小さい順にする
        points: [
          { x: 60, y: 140 },
          { x: 80, y: 110 },
          { x: 100, y: 80 },
        ],
      },
    ]);
    expect(made.condition).toBe("原稿「酸素マスク > 効果」の表の線: 心拍数");
  });

  it("列がなければ、表の列を添えて理由を返す", () => {
    const message = sectionPart(target(["血圧"], "血液"), scope(PLAIN_TABLE));
    expect(message).toContain("表から線を作れませんでした");
    expect(message).toContain("列「血圧」が表にありません（表の列: 血液, 心拍数, 状態）");
    expect(sectionPart(target(["心拍数"], "血液"), scope("<p>文だけ</p>"))).toBe(
      `${SOURCE} に表がありません`,
    );
  });
});
