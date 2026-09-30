import { describe, expect, it } from "vitest";

import {
  chartFromTable,
  chartMarkerBody,
  parseChartCell,
  parseChartSpec,
  chartFromCsv,
  readChartPayload,
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
  it("x・y・y2・ref・title・data を読み、列は , と 、 で分ける", () => {
    expect(
      spec(" x=経過; y=血液、 SpO2; y2=心拍数; ref=85, 75,−5; title=推移; data=data/a.csv "),
    ).toEqual({
      x: "経過",
      y: ["血液", "SpO2"],
      y2: ["心拍数"],
      ref: [85, 75, -5],
      title: "推移",
      data: "data/a.csv",
    });
    expect(spec("x=経過;y=SpO2;")).toEqual({
      x: "経過",
      y: ["SpO2"],
      y2: [],
      ref: [],
      title: null,
      data: null,
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
    // 時間は秒にそろえるので、s と 分 が混ざっても単位は s
    expect(data.xUnit).toBe("s");
    expect(data.series).toEqual([
      { key: "s0", label: "SpO2", panel: "y", unit: "%" },
      { key: "s1", label: "血圧（上）", panel: "y2", unit: null },
      { key: "s2", label: "血圧（下）", panel: "y2", unit: null },
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

describe("chartFromCsv", () => {
  const html = `<table>
    <thead><tr><th>経過</th><th>SpO2</th><th>血圧</th></tr></thead>
    <tbody>
      <tr><td>0 s</td><td>97.1%</td><td>119/79</td></tr>
      <tr><td>1 分</td><td>80%</td><td>90/60</td></tr>
    </tbody>
  </table>`;
  const fromTable = (): ReturnType<typeof chartFromTable> =>
    chartFromTable(table(html), spec("x=経過; y=SpO2; y2=血圧; data=a.csv"));

  it("CSV の細かい点を使い、線の名前と単位は表から取る", () => {
    const csv = [
      "# 注記の行は読まない",
      "経過,SpO2,血圧（上）,血圧（下）",
      "30,88.4,100,66",
      "0,97.08,119,79",
      "",
      "60,80.2,90,60",
      "90,,85,57",
    ].join("\r\n");
    const { data, warnings } = chartFromCsv(csv, fromTable());
    expect(warnings).toEqual([]);
    expect(data.series.map((s) => [s.label, s.unit])).toEqual([
      ["SpO2", "%"],
      ["血圧（上）", null],
      ["血圧（下）", null],
    ]);
    expect(data.points).toEqual([
      { x: 0, values: { s0: 97.08, s1: 119, s2: 79 } },
      { x: 30, values: { s0: 88.4, s1: 100, s2: 66 } },
      { x: 60, values: { s0: 80.2, s1: 90, s2: 60 } },
      { x: 90, values: { s1: 85, s2: 57 } },
    ]);
  });

  it("表の桁の半分を超える差、表の時刻の行がない、列がない、数値でないセルは警告にする", () => {
    expect(
      chartFromCsv("経過,SpO2,血圧（上）,血圧（下）\n0,97.2,119,79\n30,x,1,1", fromTable())
        .warnings,
    ).toEqual([
      "CSV の 3 行目の「x」は数値ではありません",
      "CSV の「SpO2」の点が 2 つ未満です",
      "表と CSV が食い違っています: 「経過」0 の「SpO2」が表は 97.1、CSV は 97.2",
      "CSV に「経過」が 60 の行がありません（表の行と突き合わせるため）",
    ]);
    // 横軸は名前ではなく 1 列目で読む（同じ CSV を、横軸の列名の違う表で使い回すため）
    expect(chartFromCsv("時間,SpO2\n0,97.1\n60,80", fromTable()).warnings).toEqual([
      "CSV に列「血圧（上）」がありません（CSV の列: 時間, SpO2）",
      "CSV に列「血圧（下）」がありません（CSV の列: 時間, SpO2）",
    ]);
    expect(chartFromCsv("経過\n0\n60", fromTable()).warnings).toContain(
      "CSV に横軸（1 列目）と線の列がありません",
    );
  });
});

describe("readChartPayload", () => {
  it("形の合う JSON だけを読む", () => {
    const valid = { spec: spec("x=経過; y=SpO2"), data: fromTableData() };
    expect(readChartPayload(JSON.stringify(valid))).toEqual(valid);
    expect(readChartPayload("{")).toBeNull();
    expect(readChartPayload(JSON.stringify({ ...valid, spec: { ...valid.spec, y: [] } }))).toBeNull();
    expect(readChartPayload(JSON.stringify({ ...valid, extra: 1 }))).toBeNull();
    expect(
      readChartPayload(JSON.stringify({ ...valid, data: { ...valid.data, points: [{ x: "0" }] } })),
    ).toBeNull();
  });
});

function fromTableData(): ReturnType<typeof chartFromTable>["data"] {
  return chartFromTable(
    table(
      "<table><thead><tr><th>経過</th><th>SpO2</th></tr></thead><tbody><tr><td>0 s</td><td>97%</td></tr><tr><td>5 s</td><td>92%</td></tr></tbody></table>",
    ),
    spec("x=経過; y=SpO2"),
  ).data;
}
