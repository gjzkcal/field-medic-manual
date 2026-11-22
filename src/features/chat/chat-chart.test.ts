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
import type { DrugId } from "@/features/medication/ids";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { ChartRequest } from "@/lib/bindings/ChartRequest";

const medication = await loadMedication();
const NOW = 1_793_000_000_000;
const S = 1000;
const HEALTHY = {
  blood: 100,
  pain: 100,
  blocked: false,
  pneumothorax: 0,
  tension: false,
  mask: false,
};

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
    breathing: false,
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

/** 打った薬と、何秒前に打ったか。 */
type GivenDrug = [DrugId, number];

function withRecords(records: readonly GivenDrug[]): Casualty {
  return {
    id: "c1",
    name: "A",
    createdAtMs: NOW - 9000 * S,
    inPain: false,
    records: records.map(([drug, secondsAgo], i) => ({
      id: `r${String(i)}`,
      atMs: NOW - secondsAgo * S,
      entry: { kind: "drug", drug },
    })),
  };
}

function heartRateOf(casualty: Casualty): AiChartInput {
  return input(
    {
      casualties: [
        { casualty: "c1", metrics: ["heart_rate"], patient: HEALTHY, changes: [], until: 0 },
      ],
    },
    { casualties: [casualty] },
  );
}

function line(label: string, axis: string, unit: string | null = null): ChartLine {
  return {
    label,
    axis,
    unit,
    xLabel: "経過",
    xUnit: "s",
    origin: "テストの線",
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
        scenarios: [
          {
            label: "1 本",
            metrics: ["effect"],
            patient: HEALTHY,
            changes: [],
            until: 0,
            doses: [{ drug: "morphine", seconds: 0 }],
          },
        ],
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
            metrics: ["effect"],
            patient: HEALTHY,
            changes: [],
            until: 0,
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
      input({
        scenarios: [
          {
            label: "2 本",
            metrics: ["concentration"],
            patient: HEALTHY,
            changes: [],
            until: 0,
            doses,
          },
        ],
      }),
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
        scenarios: [
          {
            label: "a",
            metrics: ["effect"],
            patient: HEALTHY,
            changes: [],
            until: 0,
            doses: [{ drug: "morphine", seconds: 0 }],
          },
        ],
      }),
    ).chart;
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["effect"],
            patient: HEALTHY,
            changes: [],
            until: 0,
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
      {
        label: "a",
        metrics: ["effect"],
        patient: HEALTHY,
        changes: [],
        until: 0,
        doses: [{ drug: "morphine", seconds: 0 }],
      },
    ];
    expect(errorOf(input({ scenarios }, { circulation: false }))).toContain("Circulation");
  });
});

describe("心拍数と血圧", () => {
  const mixed: ChartRequest["scenarios"][number]["doses"] = [
    { drug: "phenylephrine", seconds: 0 },
    { drug: "epinephrine", seconds: 0 },
    { drug: "morphine", seconds: 90 },
  ];

  it("薬ごとではなく条件ごとの線になり、量を並べた順に、単位ごとの軸に載る", () => {
    const { chart, summary } = built(
      input({
        scenarios: [
          {
            label: "同時に打つ",
            metrics: ["blood_pressure", "heart_rate"],
            doses: mixed,
            patient: HEALTHY,
            changes: [],
            until: 0,
          },
        ],
      }),
    );
    expect(chart.data.series).toStrictEqual([
      { key: "s0", label: "収縮期血圧（同時に打つ）", panel: "y", unit: "mmHg" },
      { key: "s1", label: "拡張期血圧（同時に打つ）", panel: "y", unit: "mmHg" },
      { key: "s2", label: "心拍数（同時に打つ）", panel: "y2", unit: "bpm" },
    ]);
    expect(valueAt(chart, "s0", 0)).toBeCloseTo(119.997, 2);
    expect(valueAt(chart, "s1", 0)).toBeCloseTo(79.997, 2);
    expect(valueAt(chart, "s0", 90)).toBeCloseTo(152.994, 2);
    expect(valueAt(chart, "s2", 90)).toBeCloseTo(86.1949, 3);
    // 最大は 27 s。5 s おきの点の間にあるが、AI に返す最大の値がずれないように点を残す
    expect(valueAt(chart, "s0", 27)).toBeCloseTo(231.273, 2);
    expect(summary).toContain("最大 231.3 mmHg（経過 27 s）");
    expect(chart.conditions).toStrictEqual([
      "仮の投与「同時に打つ」（血圧・心拍数）: フェニレフリン 0 秒、エピネフリン 0 秒、モルヒネ 1 分 30 秒。患者の状態: 血液量 100%、痛みの HP 100%（計算の間は一定）",
    ]);
    // モルヒネ（5150 s で消える）が消えるまで描く
    expect(chart.data.points.at(-1)?.x).toBe(5240);
  });

  it("描く範囲を指定すると、そこで線が終わり、最大・最小もその中の値になる", () => {
    const { chart, summary } = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["blood_pressure", "concentration"],
            doses: mixed,
            patient: HEALTHY,
            changes: [],
            until: 240,
          },
        ],
      }),
    );
    expect(chart.data.points.at(-1)?.x).toBe(240);
    expect(valueAt(chart, "s0", 240)).toBeCloseTo(95.748, 2);
    // 薬ごとの線も同じ範囲で終わる
    expect(chart.data.series.map((s) => s.label)).toStrictEqual([
      "収縮期血圧（a）",
      "拡張期血圧（a）",
      "エピネフリン（a）",
      "モルヒネ（a）",
      "フェニレフリン（a）",
    ]);
    expect(summary).toContain("最小 95.51 mmHg（経過 209 s）、経過 240 s で 95.75 mmHg");
    expect(chart.conditions[0]).toContain(
      "モルヒネ 1 分 30 秒。経過 240 s まで。患者の状態: 血液量 100%",
    );
  });

  it("描く範囲が薬の消える時刻より先なら、薬が消える時刻で終わる", () => {
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["effect"],
            doses: [{ drug: "epinephrine", seconds: 0 }],
            patient: HEALTHY,
            changes: [],
            until: 600,
          },
        ],
      }),
    );
    expect(chart.data.points.at(-1)?.x).toBe(164);
    expect(chart.conditions[0]).toContain("経過 164 s まで");
  });

  it("前の薬が体内から消えてから次を打っても、前の薬の分が線に出る", () => {
    // エピネフリンは 164 s で消えるので、300 s のナロキソンとは、体内にある間が重ならない
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["heart_rate"],
            doses: [
              { drug: "epinephrine", seconds: 0 },
              { drug: "naloxone", seconds: 300 },
            ],
            patient: HEALTHY,
            changes: [],
            until: 0,
          },
        ],
      }),
    );
    const alone = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["heart_rate"],
            doses: [{ drug: "epinephrine", seconds: 0 }],
            patient: HEALTHY,
            changes: [],
            until: 0,
          },
        ],
      }),
    ).chart;
    expect(valueAt(chart, "s0", 30)).toBeGreaterThan(100);
    expect(valueAt(chart, "s0", 30)).toBe(valueAt(alone, "s0", 30));
    expect(valueAt(chart, "s0", 300)).toBeCloseTo(80, 6);
    expect(chart.conditions[0]).not.toContain("記録にある前の投与");
  });

  it("前の薬で心停止になれば、消えた後に次を打つ条件でも、線は心停止で終わる", () => {
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["heart_rate"],
            doses: [
              ...Array.from({ length: 5 }, () => ({ drug: "epinephrine" as const, seconds: 0 })),
              { drug: "naloxone", seconds: 300 },
            ],
            patient: HEALTHY,
            changes: [],
            until: 0,
          },
        ],
      }),
    );
    expect(chart.data.points.at(-1)?.x).toBe(15);
    expect(chart.conditions[0]).toContain("経過 15 s で心停止");
  });

  it("患者の状態で値が変わり、効能には影響しない", () => {
    const doses: typeof mixed = [{ drug: "morphine", seconds: 0 }];
    const make = (patient: typeof HEALTHY): AiChart =>
      built(
        input({
          scenarios: [
            {
              label: "a",
              metrics: ["heart_rate", "effect"],
              doses,
              patient,
              changes: [],
              until: 0,
            },
          ],
        }),
      ).chart;
    const healthy = make(HEALTHY);
    const inPain = make({ ...HEALTHY, blood: 100, pain: 30 });
    expect(healthy.data.series.map((s) => s.label)).toStrictEqual(["心拍数（a）", "モルヒネ（a）"]);
    expect(valueAt(healthy, "s0", 0)).toBe(80);
    // 激痛の患者は、打つ前から心拍数が上がっている
    expect(valueAt(inPain, "s0", 0)).toBeCloseTo(130, 6);
    expect(valueAt(inPain, "s1", 100)).toBe(valueAt(healthy, "s1", 100));
    expect(inPain.conditions[0]).toContain("血液量 100%、痛みの HP 30%");
  });

  it("平均血圧は 1 本の線になる", () => {
    const { chart } = built(
      input({
        scenarios: [
          {
            label: "a",
            metrics: ["mean_pressure"],
            doses: [{ drug: "phenylephrine", seconds: 0 }],
            patient: { ...HEALTHY, blood: 60, pain: 100 },
            changes: [],
            until: 0,
          },
        ],
      }),
    );
    expect(chart.data.series).toStrictEqual([
      { key: "s0", label: "平均血圧（a）", panel: "y", unit: "mmHg" },
    ]);
    expect(valueAt(chart, "s0", 30)).toBeCloseTo(10.96975 * 7.5006168, 2);
  });

  it("過量投与では、心停止で線が終わり、条件に時刻を書く", () => {
    const { chart, summary } = built(
      input({
        scenarios: [
          {
            label: "4 本",
            metrics: ["heart_rate"],
            doses: Array.from({ length: 4 }, () => ({ drug: "metoprolol" as const, seconds: 0 })),
            patient: HEALTHY,
            changes: [],
            until: 0,
          },
        ],
      }),
    );
    expect(chart.data.points.at(-1)?.x).toBe(13);
    expect(chart.conditions[0]).toContain(
      "経過 11 s で意識を失う、経過 13 s で心停止になり、線はそこで終わる",
    );
    expect(summary).toContain("経過 13 s で心停止");
  });

  it("薬を打つ前に心停止している患者は、理由を返す", () => {
    expect(
      errorOf(
        input({
          scenarios: [
            {
              label: "a",
              metrics: ["heart_rate"],
              doses: [{ drug: "epinephrine", seconds: 0 }],
              patient: { ...HEALTHY, blood: 20, pain: 100 },
              changes: [],
              until: 0,
            },
          ],
        }),
      ),
    ).toContain("血液量 20%、痛みの HP 100%）では、薬を打つ前に心停止");
  });

  describe("負傷者の記録にある前の投与", () => {
    it("薬ごとの線から外した投与も、体内に残っている間は心拍数に入れる", () => {
      // エピネフリン（164 s で消える）は、最後の投与（300 s 前から 200 s 後）の時点で消えているので薬ごとの線から外れる。
      // グラフは 1 本目のモルヒネ（エピネフリンの 100 s 後）から始まり、その時点ではまだ体内に残っている
      const { chart } = built(
        heartRateOf(
          withRecords([
            ["epinephrine", 300],
            ["morphine", 200],
            ["morphine", 100],
          ]),
        ),
      );
      const alone = built(
        heartRateOf(
          withRecords([
            ["morphine", 200],
            ["morphine", 100],
          ]),
        ),
      ).chart;
      expect(valueAt(alone, "s0", 0)).toBe(80);
      expect(valueAt(chart, "s0", 0)).toBeGreaterThan(83);
      // エピネフリンが消えた後は、モルヒネだけのときと同じ値に戻る
      expect(valueAt(chart, "s0", 600)).toBeCloseTo(valueAt(alone, "s0", 600) ?? Number.NaN, 6);
      expect(chart.conditions[0]).toContain(
        "記録にある前の投与（エピネフリン）も、体内に残っている間の分を計算に入れている",
      );
      expect(alone.conditions[0]).not.toContain("記録にある前の投与");
    });

    it("前の投与で心停止に当たっていたら、後の投与だけで計算し直さず、理由を返す", () => {
      const records: GivenDrug[] = [
        ...Array.from({ length: 5 }, (): GivenDrug => ["epinephrine", 400]),
        ["naloxone", 100],
      ];
      expect(errorOf(heartRateOf(withRecords(records)))).toContain(
        "記録にある前の投与で心停止に当たっています",
      );
      // 効能は、今までどおり体内に残っている投与から作れる
      const effect = built(
        input(
          {
            casualties: [
              { casualty: "c1", metrics: ["effect"], patient: HEALTHY, changes: [], until: 0 },
            ],
          },
          { casualties: [withRecords(records)] },
        ),
      ).chart;
      expect(effect.data.series.map((s) => s.label)).toStrictEqual(["ナロキソン（A）"]);
    });

    it("投与の間隔に小数の秒があっても、線は描く範囲を超えない", () => {
      const casualty = withRecords([
        ["epinephrine", 90.25],
        ["morphine", 0],
      ]);
      const { chart } = built(
        input(
          {
            casualties: [
              {
                casualty: "c1",
                metrics: ["heart_rate", "effect"],
                patient: HEALTHY,
                changes: [],
                until: 0,
              },
            ],
          },
          { casualties: [casualty] },
        ),
      );
      // モルヒネは 90.25 s に打ち、5150 s 後に消える
      expect(chart.data.points.at(-1)?.x).toBe(5240.25);
      const lastHeartRate = chart.data.points.findLast((p) => p.values["s0"] !== undefined);
      expect(lastHeartRate?.x).toBe(5240);
    });
  });

  it("負傷者の記録からも作れる", () => {
    const casualty: Casualty = {
      id: "c1",
      name: "A",
      createdAtMs: NOW - 100 * S,
      inPain: false,
      records: [{ id: "r1", atMs: NOW - 60 * S, entry: { kind: "drug", drug: "epinephrine" } }],
    };
    const { chart } = built(
      input(
        {
          casualties: [
            { casualty: "c1", metrics: ["heart_rate"], patient: HEALTHY, changes: [], until: 0 },
          ],
        },
        { casualties: [casualty] },
      ),
    );
    expect(chart.data.series.map((s) => s.label)).toStrictEqual(["心拍数（A）"]);
    expect(chart.conditions[0]).toContain("負傷者「A」の記録（心拍数）: エピネフリン 0 秒");
    expect(Math.max(...chart.data.points.map((p) => p.values["s0"] ?? 0))).toBeGreaterThan(90);
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
      input(
        {
          casualties: [
            { casualty: "c1", metrics: ["effect"], patient: HEALTHY, changes: [], until: 0 },
          ],
        },
        { casualties: [casualty] },
      ),
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
    const target: ChartRequest["casualties"] = [
      { casualty: "c9", metrics: ["effect"], patient: HEALTHY, changes: [], until: 0 },
    ];
    expect(errorOf(input({ casualties: target }, { casualties: [casualty] }))).toContain(
      "A（id: c1）",
    );
    expect(errorOf(input({ casualties: target }))).toContain("負傷者は記録されていません");
    const noDrug = { ...casualty, records: casualty.records.slice(2, 4) };
    expect(
      errorOf(
        input(
          {
            casualties: [
              { casualty: "c1", metrics: ["effect"], patient: HEALTHY, changes: [], until: 0 },
            ],
          },
          { casualties: [noDrug] },
        ),
      ),
    ).toContain("薬の記録がありません");
  });
});

describe("原稿の節の線", () => {
  const manual: ChartPart = {
    lines: [
      {
        ...line("濃度（モルヒネ）", "unit:nM", "nM"),
        origin: "原稿「モルヒネ > 濃度の推移」のグラフの値",
      },
    ],
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
              metrics: ["concentration"],
              patient: HEALTHY,
              changes: [],
              until: 0,
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
    // 値と出どころは同じ行に書く（名前の同じ線があっても対応が取れるように）
    expect(summary).toMatch(
      /^- モルヒネ（2 本）（nM）: 経過 0 s で 0 nM、.+。［値の出どころ: アプリの計算］$/mu,
    );
    expect(summary).toContain(
      "- 濃度（モルヒネ）（nM）: 経過 0 s で 1 nM、経過 10 s で 2 nM。［値の出どころ: 原稿「モルヒネ > 濃度の推移」のグラフの値］",
    );
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

  it("同じ線に、横軸が同じ点が 2 つあれば止める（別の線どうしなら同じ横軸でよい）", () => {
    const twice = {
      ...line("a", "x"),
      points: [
        { x: 60, y: 80 },
        { x: 60, y: 120 },
        { x: 90, y: 100 },
      ],
    };
    expect(composeChart("題", [twice])).toBe(
      "「a」に、横軸が同じ点が 2 つあります（経過 60 s）。横軸ごとに 1 点の線だけをグラフにできます",
    );
    expect(typeof composeChart("題", [line("a", "x"), line("b", "x")])).toBe("object");
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

/** 薬なしで SpO2 を 600 s まで見る条件。over で上書きする。 */
function spo2Scenario(
  over: Partial<ChartRequest["scenarios"][number]>,
): ChartRequest["scenarios"][number] {
  return {
    label: "a",
    metrics: ["spo2"],
    doses: [],
    patient: HEALTHY,
    changes: [],
    until: 600,
    ...over,
  };
}

/** Breathing を使っている利用者で、spo2Scenario の条件からグラフを作る。 */
function chartOf(over: Partial<ChartRequest["scenarios"][number]>): {
  chart: AiChart;
  summary: string;
} {
  return built(input({ scenarios: [spo2Scenario(over)] }, { breathing: true }));
}

describe("SpO2（Breathing）", () => {
  const NO_CHANGE = {
    blood: null,
    pain: null,
    blocked: null,
    pneumothorax: null,
    tension: null,
    mask: null,
  };

  it("薬なしで、気道が塞がってから確保するまでの SpO2 を描く", () => {
    const { chart, summary } = chartOf({
      label: "2 分後に確保",
      patient: { ...HEALTHY, blocked: true },
      changes: [{ ...NO_CHANGE, seconds: 120, blocked: false }],
    });
    expect(chart.data.series).toStrictEqual([
      { key: "s0", label: "SpO2（2 分後に確保）", panel: "y", unit: "%" },
    ]);
    expect(valueAt(chart, "s0", 0)).toBeCloseTo(97.1486, 3);
    expect(valueAt(chart, "s0", 120)).toBeCloseTo(76.79, 3);
    expect(valueAt(chart, "s0", 300)).toBeCloseTo(97.0531, 3);
    expect(chart.data.points.at(-1)?.x).toBe(600);
    expect(chart.conditions).toStrictEqual([
      "仮の投与「2 分後に確保」（SpO2）: 薬なし。経過 600 s まで。患者の状態: 血液量 100%、痛みの HP 100%、気道が塞がっている（0 s から）。途中の変更: 経過 120 s から 気道を確保",
    ]);
    // 最小は、確保した次の 1 s（5 s おきの点の間にあるが、残す）
    expect(summary).toMatch(/最小 76\.68 %（経過 121 s）/u);
  });

  it("心停止の後は、心拍数の線は終わり、SpO2 の線は続く", () => {
    const { chart } = chartOf({
      metrics: ["spo2", "heart_rate"],
      patient: { ...HEALTHY, blocked: true },
    });
    const last = (key: string): number | undefined =>
      chart.data.points.findLast((p) => p.values[key] !== undefined)?.x;
    expect(last("s0")).toBe(600);
    expect(last("s1")).toBe(382);
    expect(valueAt(chart, "s0", 600)).toBeCloseTo(48.8963, 3);
    expect(chart.conditions[0]).toContain(
      "経過 382 s で心停止になる（心拍数と血圧の線はそこで終わる。SpO2 は、CPR をしない前提でその後も続く）",
    );
    expect(chart.conditions[0]).toContain("で意識を失う");
  });

  it("気胸と、チェストシール・酸素マスクの変更を条件に書く", () => {
    const { chart } = chartOf({
      patient: { ...HEALTHY, pneumothorax: 72, tension: true },
      changes: [
        { ...NO_CHANGE, seconds: 60, pneumothorax: 0, mask: true },
        { ...NO_CHANGE, seconds: 90, tension: false },
      ],
    });
    expect(valueAt(chart, "s0", 0)).toBeCloseTo(84.3932, 3);
    expect(valueAt(chart, "s0", 600)).toBeGreaterThan(99);
    expect(chart.conditions[0]).toContain(
      "患者の状態: 血液量 100%、痛みの HP 100%、気胸の大きさ 72%、緊張性気胸。途中の変更: 経過 60 s から 気胸の大きさ 0%・酸素マスクを付ける、経過 90 s から 緊張性気胸を解除",
    );
    expect(chart.conditions[0]).toContain("気胸の悪化は計算に入れていない");
  });

  it("薬と一緒でも、SpO2 は薬では動かない", () => {
    const { chart } = chartOf({
      metrics: ["spo2", "blood_pressure"],
      doses: [{ drug: "phenylephrine", seconds: 0 }],
      until: 0,
    });
    const spo2 = chart.data.points.flatMap((p) => p.values["s0"] ?? []);
    expect(Math.max(...spo2) - Math.min(...spo2)).toBeLessThan(0.01);
    expect(valueAt(chart, "s1", 30)).toBeGreaterThan(150);
    expect(chart.data.series.map((s) => s.panel)).toStrictEqual(["y", "y2", "y2"]);
  });

  it("Breathing がなければ、SpO2 と気道・気胸・マスクの指定は理由を返す", () => {
    const without = (over: Partial<ChartRequest["scenarios"][number]>): string =>
      errorOf(input({ scenarios: [spo2Scenario(over)] }));
    expect(without({})).toContain("Breathing を使っているときだけ");
    expect(without({ metrics: ["heart_rate"], patient: { ...HEALTHY, mask: true } })).toContain(
      "Breathing",
    );
    expect(
      without({
        metrics: ["heart_rate"],
        changes: [{ ...NO_CHANGE, seconds: 10, tension: true }],
      }),
    ).toContain("Breathing");
    // 血液量と痛みの変更は、Breathing がなくても使える
    const { chart } = built(
      input({
        scenarios: [
          spo2Scenario({
            metrics: ["heart_rate"],
            changes: [{ ...NO_CHANGE, seconds: 60, pain: 30 }],
            until: 120,
          }),
        ],
      }),
    );
    expect(valueAt(chart, "s0", 60)).toBe(80);
    expect(valueAt(chart, "s0", 120)).toBeCloseTo(130, 3);
    expect(chart.conditions[0]).toContain("途中の変更: 経過 60 s から 痛みの HP 30%");
  });
});

/** Breathing を使っている利用者で、spo2Scenario の条件が返す理由。 */
function spo2Error(over: Partial<ChartRequest["scenarios"][number]>): string {
  return errorOf(input({ scenarios: [spo2Scenario(over)] }, { breathing: true }));
}

describe("描く範囲と途中の変更", () => {
  const NO_CHANGE = {
    blood: null,
    pain: null,
    blocked: null,
    pneumothorax: null,
    tension: null,
    mask: null,
  };

  it("範囲を指定すれば、薬が消えた後の変更まで SpO2 を描き、薬ごとの線は消える時刻で終わる", () => {
    // エピネフリンは 164 s で消える。気道が塞がるのは、その後の 300 s
    const { chart } = chartOf({
      metrics: ["spo2", "effect"],
      doses: [{ drug: "epinephrine", seconds: 0 }],
      changes: [{ ...NO_CHANGE, seconds: 300, blocked: true }],
      until: 480,
    });
    const last = (key: string): number | undefined =>
      chart.data.points.findLast((p) => p.values[key] !== undefined)?.x;
    expect(last("s0")).toBe(480);
    expect(last("s1")).toBe(164);
    expect(valueAt(chart, "s0", 300)).toBeCloseTo(97.1486, 2);
    expect(valueAt(chart, "s0", 480)).toBeLessThan(80);
    expect(chart.conditions[0]).toContain("経過 480 s まで");
  });

  it("描く範囲の外の変更は、線に出ないので理由を返す", () => {
    // 範囲の指定がなければ、薬が消える時刻（164 s）まで
    expect(
      spo2Error({
        doses: [{ drug: "epinephrine", seconds: 0 }],
        changes: [{ ...NO_CHANGE, seconds: 300, blocked: true }],
        until: 0,
      }),
    ).toContain("300 秒は、描く範囲（経過 164 s まで）の外");
    expect(spo2Error({ changes: [{ ...NO_CHANGE, seconds: 600, mask: true }] })).toContain(
      "600 秒は、描く範囲（経過 600 s まで）の外",
    );
  });

  it("薬が消える時刻に小数の秒があるとき、切り下げた終わりの秒の変更は理由を返す", () => {
    // エピネフリン（164 s で消える）を 0.4 s 前の記録から始めるので、終わりは 164 s ちょうどではなく小数になる
    const casualty = withRecords([
      ["epinephrine", 100.4],
      ["epinephrine", 100],
    ]);
    const at = (seconds: number): AiChartInput =>
      input(
        {
          casualties: [
            {
              casualty: "c1",
              metrics: ["spo2"],
              patient: HEALTHY,
              changes: [{ ...NO_CHANGE, seconds, mask: true }],
              until: 0,
            },
          ],
        },
        { casualties: [casualty], breathing: true },
      );
    // 描く範囲は 164.4 s まで。計算は 164 s までなので、164 s の変更は次の更新がなく、線に出ない
    expect(errorOf(at(164))).toContain("164 秒は、描く範囲（経過 164 s まで）の外");
    expect(built(at(163)).chart.data.points.at(-1)?.x).toBe(164);
  });

  it("過量投与で心停止になれば、薬だけの条件でも SpO2 が下がる", () => {
    const { chart } = chartOf({
      doses: Array.from({ length: 5 }, () => ({ drug: "epinephrine" as const, seconds: 0 })),
      until: 300,
    });
    expect(valueAt(chart, "s0", 15)).toBeCloseTo(97.1486, 1);
    expect(valueAt(chart, "s0", 300)).toBeLessThan(65);
    expect(chart.conditions[0]).toContain("経過 15 s で心停止になる");
  });

  it("Circulation がなければ、Breathing があっても薬なしの SpO2 は理由を返す", () => {
    expect(
      errorOf(input({ scenarios: [spo2Scenario({})] }, { breathing: true, circulation: false })),
    ).toContain("Circulation を使っているときだけ");
  });
});
