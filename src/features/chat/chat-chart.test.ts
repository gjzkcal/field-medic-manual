import { describe, expect, it } from "vitest";

import { buildForecasts, concentrationsAt } from "@/features/casualties/forecast";
import {
  buildAiChart,
  composeChart,
  type AiChart,
  type AiChartInput,
  type ChartLine,
  type ChartPart,
} from "@/features/chat/chat-chart";
import { loadMedication } from "@/features/medication/bundle";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { ChartRequest } from "@/lib/bindings/ChartRequest";

const medication = await loadMedication();
const NOW = 1_793_000_000_000;
const S = 1000;

const EMPTY: ChartRequest = {
  title: "題",
  scenarios: [],
  casualties: [],
  sections: [],
  values: [],
};

function input(request: Partial<ChartRequest>, extra: Partial<AiChartInput> = {}): AiChartInput {
  return {
    request: { ...EMPTY, ...request },
    medication,
    casualties: [],
    sections: [],
    circulation: true,
    nowMs: NOW,
    ...extra,
  };
}

function built(value: AiChartInput): { chart: AiChart; summary: string } {
  const result = buildAiChart(value);
  if (!result.ok) {
    throw new Error(`作れるはず: ${result.error}`);
  }
  return result;
}

function errorOf(value: AiChartInput): string {
  const result = buildAiChart(value);
  if (result.ok) {
    throw new Error("作れないはず");
  }
  return result.error;
}

/** 線 key の、x での値。 */
function valueAt(chart: AiChart, key: string, x: number): number | undefined {
  return chart.data.points.find((p) => p.x === x)?.values[key];
}

function line(label: string, axis: string, unit: string | null = null): ChartLine {
  return {
    label,
    axis,
    unit,
    xLabel: "経過",
    xUnit: "s",
    points: [
      { x: 0, y: 1 },
      { x: 10, y: 2 },
    ],
  };
}

describe("仮の投与", () => {
  it("1 本の効能は、負傷者の画面の計算と同じ値になる", () => {
    const { chart } = built(
      input({
        scenarios: [{ label: "1 本", metric: "effect", doses: [{ drug: "morphine", seconds: 0 }] }],
      }),
    );
    const forecast = buildForecasts(medication, [{ drug: "morphine", atMs: NOW }])[0];
    expect(chart.data.series).toStrictEqual([
      { key: "s0", label: "モルヒネ（1 本）", panel: "y", unit: "%" },
    ]);
    for (const seconds of [0, 100, 600, 3000]) {
      const expected = forecast?.points.find((p) => p.seconds === seconds)?.percent;
      expect(expected).toBeDefined();
      expect(valueAt(chart, "s0", seconds)).toBeCloseTo(expected ?? Number.NaN, 9);
    }
    expect(Math.max(...chart.data.points.map((p) => p.values["s0"] ?? 0))).toBeCloseTo(100, 0);
    expect(chart.data.xUnit).toBe("s");
  });

  it("前の投与が体内から消えた後の投与も、指定した時刻のまま線に残る", () => {
    // エピネフリンは 164 s で消える。buildForecasts は 600 s の時点で消えている 1 本目を外す
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "10 分あけて",
            metric: "effect",
            doses: [
              { drug: "epinephrine", seconds: 0 },
              { drug: "epinephrine", seconds: 600 },
            ],
          },
        ],
      }),
    );
    expect(valueAt(chart, "s0", 25)).toBeGreaterThan(90);
    expect(valueAt(chart, "s0", 300)).toBe(0);
    expect(valueAt(chart, "s0", 625)).toBeGreaterThan(90);
    expect(chart.data.points.at(-1)?.x).toBe(764);
  });

  it("濃度は、時刻ごとの濃度の合計になる", () => {
    const doses = [
      { drug: "morphine" as const, seconds: 0 },
      { drug: "morphine" as const, seconds: 180 },
    ];
    const { chart, summary } = built(
      input({ scenarios: [{ label: "2 本", metric: "concentration", doses }] }),
    );
    expect(chart.data.series[0]?.unit).toBe("nM");
    const expected = concentrationsAt(
      medication,
      doses.map((d) => ({ drug: d.drug, atMs: d.seconds * S })),
      400 * S,
    ).morphine;
    expect(valueAt(chart, "s0", 400)).toBe(expected);
    expect(summary).toContain("モルヒネ（2 本）（nM）");
    expect(summary).toContain("仮の投与「2 本」（濃度）: モルヒネ 0 秒、モルヒネ 3 分 0 秒");
  });

  it("薬ごとに 1 本の線になり、ナロキソンを打つとモルヒネの効能が下がる", () => {
    const morphineOnly = built(
      input({
        scenarios: [{ label: "a", metric: "effect", doses: [{ drug: "morphine", seconds: 0 }] }],
      }),
    ).chart;
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "a",
            metric: "effect",
            doses: [
              { drug: "naloxone", seconds: 60 },
              { drug: "morphine", seconds: 0 },
            ],
          },
        ],
      }),
    );
    expect(chart.data.series.map((s) => s.label)).toStrictEqual([
      "モルヒネ（a）",
      "ナロキソン（a）",
    ]);
    expect(valueAt(chart, "s0", 300)).toBeLessThan(valueAt(morphineOnly, "s0", 300) ?? 0);
  });

  it("Circulation なしでは、薬の推移を作らない", () => {
    const scenarios: ChartRequest["scenarios"] = [
      { label: "a", metric: "effect", doses: [{ drug: "morphine", seconds: 0 }] },
    ];
    expect(errorOf(input({ scenarios }, { circulation: false }))).toContain("Circulation");
  });
});

describe("負傷者の記録", () => {
  const casualty: Casualty = {
    id: "c1",
    name: "A",
    createdAtMs: NOW - 9000 * S,
    inPain: false,
    records: [
      // 前に看たときの記録。最後の投与の時点で消えているので、線に入れない
      { id: "r0", atMs: NOW - 9000 * S, entry: { kind: "drug", drug: "epinephrine" } },
      { id: "r1", atMs: NOW - 120 * S, entry: { kind: "drug", drug: "morphine" } },
      { id: "r2", atMs: NOW - 100 * S, entry: { kind: "drug", drug: "ammonium_carbonate" } },
      { id: "r3", atMs: NOW - 60 * S, entry: { kind: "saline" } },
      { id: "r4", atMs: NOW - 30 * S, entry: { kind: "drug", drug: "epinephrine" } },
    ],
  };

  it("体内に残っている投与から作り、横軸の 0 を最初の投与にする", () => {
    const { chart } = built(
      input({ casualties: [{ casualty: "c1", metric: "effect" }] }, { casualties: [casualty] }),
    );
    expect(chart.data.series.map((s) => s.label)).toStrictEqual([
      "エピネフリン（A）",
      "モルヒネ（A）",
    ]);
    // エピネフリンは 90 s 後（モルヒネの 90 s 後）に打ったので、それまでは 0
    expect(valueAt(chart, "s0", 85)).toBe(0);
    expect(valueAt(chart, "s0", 115)).toBeGreaterThan(90);
    expect(chart.conditions).toStrictEqual([
      "負傷者「A」の記録（効能）: モルヒネ 0 秒、エピネフリン 1 分 30 秒。横軸の 0 は 2 分 0 秒 前の投与",
    ]);
  });

  it("いない負傷者と、薬の記録のない負傷者は理由を返す", () => {
    const target: ChartRequest["casualties"] = [{ casualty: "c9", metric: "effect" }];
    expect(errorOf(input({ casualties: target }, { casualties: [casualty] }))).toContain(
      "A（id: c1）",
    );
    expect(errorOf(input({ casualties: target }))).toContain("負傷者は記録されていません");
    const noDrug = { ...casualty, records: casualty.records.slice(2, 4) };
    expect(
      errorOf(
        input({ casualties: [{ casualty: "c1", metric: "effect" }] }, { casualties: [noDrug] }),
      ),
    ).toContain("薬の記録がありません");
  });
});

describe("原稿の節の線", () => {
  const manual: ChartPart = {
    kind: "manual",
    lines: [{ ...line("濃度（モルヒネ）", "unit:nM", "nM"), xLabel: "経過" }],
    condition: "原稿「モルヒネ > 濃度の推移」のグラフの線: 濃度",
    source: { title: "モルヒネ > 濃度の推移", docId: "doc-morphine", anchor: "濃度の推移" },
  };

  it("計算した濃度と同じ軸に重ね、元の節を残す", () => {
    const { chart, summary } = built(
      input(
        {
          scenarios: [
            {
              label: "2 本",
              metric: "concentration",
              doses: [
                { drug: "morphine", seconds: 0 },
                { drug: "morphine", seconds: 180 },
              ],
            },
          ],
        },
        { sections: [manual] },
      ),
    );
    expect(chart.data.series.map((s) => [s.label, s.panel])).toStrictEqual([
      ["モルヒネ（2 本）", "y"],
      ["濃度（モルヒネ）", "y"],
    ]);
    expect(chart.sources).toStrictEqual([manual.source]);
    // AI が、計算した値と原稿の値を取り違えないように、線ごとの出どころを返す
    expect(summary).toContain("- モルヒネ（2 本）: アプリの計算");
    expect(summary).toContain("- 濃度（モルヒネ）: 原稿の節のグラフ・表の値");
    expect(summary).toContain("- 原稿「モルヒネ > 濃度の推移」のグラフの線: 濃度");
  });

  it("同じ節を 2 つの指定で使っても、開く節は 1 つにまとめる", () => {
    const other: ChartPart = { ...manual, lines: [line("鎮痛量（モルヒネ）", "unit:")] };
    expect(built(input({}, { sections: [manual, other] })).chart.sources).toStrictEqual([
      manual.source,
    ]);
  });

  it("薬の線がなければ、Circulation なしでも描ける", () => {
    expect(built(input({}, { sections: [manual], circulation: false })).chart.sources).toHaveLength(
      1,
    );
  });
});

describe("利用者の数値", () => {
  it("分は秒に直し、Circulation なしでも描ける", () => {
    const { chart } = built(
      input(
        {
          values: [
            {
              label: "心拍数",
              unit: "bpm",
              minutes: true,
              points: [
                { x: 0, y: 80 },
                { x: 1.5, y: 120 },
              ],
            },
          ],
        },
        { circulation: false },
      ),
    );
    expect(chart.data.points).toStrictEqual([
      { x: 0, values: { s0: 80 } },
      { x: 90, values: { s0: 120 } },
    ]);
    expect(chart.data.series[0]).toStrictEqual({
      key: "s0",
      label: "心拍数",
      panel: "y",
      unit: "bpm",
    });
    expect(chart.conditions).toStrictEqual(["利用者が示した数値「心拍数」: 2 点"]);
  });
});

describe("composeChart", () => {
  it("同じ単位でも、量が違えば別のグラフに分ける", () => {
    const composed = composeChart("題", [
      line("効能", "effect", "%"),
      line("SpO2", "unit:%", "%"),
      line("別の効能", "effect", "%"),
    ]);
    if (typeof composed === "string") {
      throw new TypeError(composed);
    }
    expect(composed.data.series.map((s) => [s.key, s.panel])).toStrictEqual([
      ["s0", "y"],
      ["s1", "y2"],
      ["s2", "y"],
    ]);
    expect(composed.spec).toMatchObject({
      title: "題",
      y: ["効能", "別の効能"],
      y2: ["SpO2"],
    });
  });

  it("横軸は全部の線の点を合わせて、小さい順に並べる", () => {
    const composed = composeChart("題", [
      line("a", "x"),
      {
        ...line("b", "x"),
        points: [
          { x: 5, y: 9 },
          { x: 10, y: 8 },
        ],
      },
    ]);
    if (typeof composed === "string") {
      throw new TypeError(composed);
    }
    expect(composed.data.points).toStrictEqual([
      { x: 0, values: { s0: 1 } },
      { x: 5, values: { s1: 9 } },
      { x: 10, values: { s0: 2, s1: 8 } },
    ]);
  });

  it("横軸の単位が違う線は、1 つのグラフにしない", () => {
    const composed = composeChart("題", [line("a", "x"), { ...line("b", "x"), xUnit: "kPa" }]);
    expect(composed).toContain("横軸の単位が合いません（「a」は s、「b」は kPa）");
  });

  it("時間でない横軸は、見出しが違えば 1 つのグラフにしない", () => {
    const composed = composeChart("題", [
      { ...line("a", "x"), xUnit: "mL", xLabel: "出血量" },
      { ...line("b", "x"), xUnit: "mL", xLabel: "輸液量" },
    ]);
    expect(composed).toContain("横軸が違います（「a」は 出血量、「b」は 輸液量）");
  });

  it("時間の横軸の見出しは、全部の線で同じならそのまま、違えば「経過」にする", () => {
    const same = composeChart("題", [
      { ...line("a", "x"), xLabel: "付けてからの時間" },
      { ...line("b", "x"), xLabel: "付けてからの時間" },
    ]);
    const mixed = composeChart("題", [
      line("a", "x"),
      { ...line("b", "x"), xLabel: "付けてからの時間" },
    ]);
    if (typeof same === "string" || typeof mixed === "string") {
      throw new TypeError("作れるはず");
    }
    expect(same.data.xLabel).toBe("付けてからの時間");
    expect(mixed.data.xLabel).toBe("経過");
  });

  it("線が 6 本・量が 3 種類・点が 1 つなら、理由を返す", () => {
    const six = Array.from({ length: 6 }, (_unused, i) => line(String(i), "x"));
    expect(composeChart("題", six)).toContain("5 本まで");
    expect(composeChart("題", [line("a", "x"), line("b", "y"), line("c", "z")])).toContain(
      "2 種類まで",
    );
    expect(composeChart("題", [{ ...line("a", "x"), points: [{ x: 0, y: 1 }] }])).toContain(
      "2 つ未満",
    );
  });
});
