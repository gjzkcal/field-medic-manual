import { describe, expect, it } from "vitest";

import {
  chartFromTable,
  chartMarkerBody,
  parseChartCell,
  parseChartSpec,
  readChartSpec,
  type ChartSpec,
} from "@/features/content/chart";

function spec(body: string): ChartSpec {
  const parsed = parseChartSpec(body);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  return parsed.spec;
}

function table(html: string): HTMLTableElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  const found = container.querySelector("table");
  if (found === null) {
    throw new Error("表がありません");
  }
  return found;
}

describe("chartMarkerBody", () => {
  it("chart: で始まるコメントだけを印として読む", () => {
    expect(chartMarkerBody(" chart: x=a; y=b ")).toBe(" x=a; y=b ");
    expect(chartMarkerBody("chart：x=a")).toBe("x=a");
    expect(chartMarkerBody(" tags: a, b ")).toBeNull();
  });
});

describe("parseChartSpec", () => {
  it("x・y・y2・ref・title を読み、列は , と 、 で分ける", () => {
    expect(spec(" x=経過; y=血液、 SpO2; y2=心拍数; ref=85, 75,−5; title=推移 ")).toEqual({
      x: "経過",
      y: ["血液", "SpO2"],
      y2: ["心拍数"],
      ref: [85, 75, -5],
      title: "推移",
    });
    expect(spec("x=経過;y=SpO2;")).toEqual({
      x: "経過",
      y: ["SpO2"],
      y2: [],
      ref: [],
      title: null,
    });
  });

  it.each([
    ["x=経過", "必須"],
    ["y=SpO2", "必須"],
    ["x=経過; y=SpO2; color=red", "知らないキー「color」"],
    ["x=経過; y=SpO2; y=血液", "2 回あります"],
    ["x=経過; y=", "値が空"],
    ["x=経過; y=SpO2; 凡例", "「キー=値」の形ではありません"],
    ["x=経過; y=SpO2, 経過", "列「経過」を 2 回"],
    ["x=経過; y=SpO2; ref=85%", "数値ではありません"],
  ])("%s は %s のエラーにする", (body, message) => {
    const parsed = parseChartSpec(body);
    expect("error" in parsed ? parsed.error : "").toContain(message);
  });
});

describe("parseChartCell", () => {
  it.each([
    ["0 s", [0]],
    ["97.1%", [97.1]],
    ["3 分", [180]],
    ["12.5 分", [750]],
    ["30 秒", [30]],
    ["914 s（約 15 分 14 秒）", [914]],
    ["172.9 (頻脈)", [172.9]],
    ["119/79", [119, 79]],
    ["0/0", [0, 0]],
    ["−4.9%", [-4.9]],
    ["15 ml/s", [15]],
    ["93 mmHg", [93]],
  ])("%s は %j", (text, expected) => {
    expect(parseChartCell(text)).toEqual(expected);
  });

  it.each(["85% 未満", "約 3 分", "—", "", "Stable", "150 s 血液 25%"])(
    "%s は点にしない",
    (text) => {
      expect(parseChartCell(text)).toBeNull();
    },
  );
});

describe("chartFromTable", () => {
  const html = `<table>
    <thead><tr><th>経過</th><th>SpO2</th><th>血圧</th><th>状態</th></tr></thead>
    <tbody>
      <tr><td>1 分</td><td>80%</td><td>90/60</td><td>A</td></tr>
      <tr><td>0 s</td><td>97.1%</td><td>119/79</td><td>B</td></tr>
      <tr><td>16 s</td><td>85% 未満</td><td>100/66</td><td>C</td></tr>
      <tr><td>—</td><td>50%</td><td>1/1</td><td>D</td></tr>
    </tbody>
  </table>`;

  it("横軸の小さい順に点を並べ、a/b の列は上と下の 2 本に分ける", () => {
    const { data, warnings } = chartFromTable(table(html), spec("x=経過; y=SpO2; y2=血圧"));
    expect(warnings).toEqual([]);
    expect(data.xLabel).toBe("経過");
    expect(data.series).toEqual([
      { key: "s0", label: "SpO2", axis: "left" },
      { key: "s1", label: "血圧（上）", axis: "right" },
      { key: "s2", label: "血圧（下）", axis: "right" },
    ]);
    // 横軸が「—」の行は捨て、「85% 未満」は点にしない
    expect(data.points).toEqual([
      { x: 0, values: { s0: 97.1, s1: 119, s2: 79 } },
      { x: 16, values: { s1: 100, s2: 66 } },
      { x: 60, values: { s0: 80, s1: 90, s2: 60 } },
    ]);
  });

  it("表にない列と、点が 2 つ未満の線は警告にする", () => {
    expect(chartFromTable(table(html), spec("x=経過; y=脈")).warnings).toEqual([
      "列「脈」が表にありません（表の列: 経過, SpO2, 血圧, 状態）",
    ]);
    expect(chartFromTable(table(html), spec("x=経過; y=状態")).warnings).toEqual([
      "「状態」の点が 2 つ未満です（数値のセルが足りません）",
    ]);
    // 横軸の列が無ければ、線ごとの「点が足りない」は重ねて出さない
    expect(chartFromTable(table(html), spec("x=時間; y=SpO2")).warnings).toHaveLength(1);
  });
});

describe("readChartSpec", () => {
  it("形の合う JSON だけを読む", () => {
    const valid = spec("x=経過; y=SpO2");
    expect(readChartSpec(JSON.stringify(valid))).toEqual(valid);
    expect(readChartSpec("{")).toBeNull();
    expect(readChartSpec(JSON.stringify({ ...valid, y: [] }))).toBeNull();
    expect(readChartSpec(JSON.stringify({ ...valid, extra: 1 }))).toBeNull();
  });
});
