// 心拍数と血圧の計算を、原稿のグラフの CSV（薬 1 本ずつの推移）と、ACE の式を別に写した計算の値と突き合わせる。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Dose } from "@/features/casualties/forecast";
import {
  bloodPressureMmhg,
  HEALTHY_PATIENT,
  kpaToMmhg,
  simulateVitals,
  type PatientState,
  type VitalsTimeline,
} from "@/features/casualties/vitals";
import { loadMedication } from "@/features/medication/bundle";
import type { DrugId } from "@/features/medication/schema";
import { REPO_ROOT } from "@/test/samples";

const medication = await loadMedication();
const MS = 1000;

function doses(...list: readonly [DrugId, number][]): Dose[] {
  return list.map(([drug, seconds]) => ({ drug, atMs: seconds * MS }));
}

function run(
  given: readonly Dose[],
  endSeconds: number,
  patient: PatientState = HEALTHY_PATIENT,
  settleSeconds?: number,
): VitalsTimeline {
  return simulateVitals({
    medication,
    doses: given,
    patient,
    endSeconds,
    ...(settleSeconds === undefined ? {} : { settleSeconds }),
  });
}

function at(timeline: VitalsTimeline, seconds: number): VitalsTimeline["points"][number] {
  const point = timeline.points.find((p) => p.seconds === seconds);
  if (point === undefined) {
    throw new Error(`${String(seconds)} s の点がありません`);
  }
  return point;
}

/** 原稿の CSV の行（# の行と見出しを除く）。 */
function csvRows(name: string): { header: string[]; rows: number[][] } {
  const lines = readFileSync(resolve(REPO_ROOT, "content", "manuals", "data", name), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line !== "" && !line.startsWith("#"));
  const [header, ...rows] = lines.map((line) => line.split(","));
  if (header === undefined) {
    throw new Error(`${name} が空です`);
  }
  return { header, rows: rows.map((row) => row.map(Number)) };
}

describe("原稿のグラフの値と合う", () => {
  // CSV は、既定の心拍数（80）から始めた値なので、打つ前に進める分を 0 にして比べる
  const VALUES: Record<string, (point: VitalsTimeline["points"][number]) => number> = {
    心拍数: (point) => point.heartRate,
    平均血圧: (point) => kpaToMmhg(point.meanPressureKpa),
  };
  // columns は、比べる列。CSV の見出しが変わって比べる列が減ったら、ここで気づけるようにする
  const cases: { file: string; drug: DrugId; patient: PatientState; columns: string[] }[] = [
    {
      file: "epinephrine.csv",
      drug: "epinephrine",
      patient: HEALTHY_PATIENT,
      columns: ["心拍数", "平均血圧"],
    },
    {
      file: "metoprolol.csv",
      drug: "metoprolol",
      patient: HEALTHY_PATIENT,
      columns: ["心拍数", "平均血圧"],
    },
    {
      file: "phenylephrine.csv",
      drug: "phenylephrine",
      patient: HEALTHY_PATIENT,
      columns: ["平均血圧"],
    },
    // 痛みの HP が 30% の患者（CSV の頭のコメントの条件）
    {
      file: "morphine.csv",
      drug: "morphine",
      patient: { blood: 1, painHealth: 0.3 },
      columns: ["心拍数", "平均血圧"],
    },
  ];

  it.each(cases)("$file", ({ file, drug, patient, columns }) => {
    const { header, rows } = csvRows(file);
    expect(header.filter((name) => name in VALUES)).toStrictEqual(columns);
    expect(rows.length).toBeGreaterThan(100);
    const last = rows.at(-1)?.[0] ?? 0;
    const timeline = run(doses([drug, 0]), last, patient, 0);
    for (const row of rows) {
      const point = at(timeline, row[0] ?? Number.NaN);
      for (const column of columns) {
        // CSV は小数 3 桁
        expect(VALUES[column]?.(point)).toBeCloseTo(row[header.indexOf(column)] ?? Number.NaN, 2);
      }
    }
  });
});

describe("健康な患者", () => {
  it("何も打たなければ、既定の値のまま", () => {
    const timeline = run([], 120);
    expect(timeline.points).toHaveLength(121);
    for (const point of timeline.points) {
      expect(point.heartRate).toBe(80);
      expect(point.meanPressureKpa).toBeCloseTo(12.443, 12);
    }
    const pressure = bloodPressureMmhg(12.443);
    expect(pressure.systolic).toBeCloseTo(119.997, 3);
    expect(pressure.diastolic).toBeCloseTo(79.997, 3);
    expect(timeline.unconsciousAtSeconds).toBeNull();
    expect(timeline.arrestAtSeconds).toBeNull();
  });

  it("フェニレフリンとエピネフリンを同時に打ち、90 s 後にモルヒネを打つ", () => {
    const timeline = run(doses(["phenylephrine", 0], ["epinephrine", 0], ["morphine", 90]), 400);
    // 期待値は、ACE の式を別に写した計算で出した値（経過, 心拍数, 収縮期, 拡張期）
    const expected = [
      [0, 80, 119.997, 79.997],
      [30, 104.5889, 230.508, 153.67],
      [90, 86.1949, 152.994, 101.994],
      [120, 73.9896, 117.264, 78.175],
      // エピネフリン（164 s）とフェニレフリン（188 s）が体内から取り除かれた後
      [240, 67.0757, 95.748, 63.831],
      [400, 68.6804, 98.658, 65.771],
    ] as const;
    for (const [seconds, heartRate, systolic, diastolic] of expected) {
      const point = at(timeline, seconds);
      const pressure = bloodPressureMmhg(point.meanPressureKpa);
      expect(point.heartRate).toBeCloseTo(heartRate, 3);
      expect(pressure.systolic).toBeCloseTo(systolic, 2);
      expect(pressure.diastolic).toBeCloseTo(diastolic, 2);
    }
    const peak = timeline.points.reduce((a, b) => (b.meanPressureKpa > a.meanPressureKpa ? b : a));
    expect(peak.seconds).toBe(27);
    expect(bloodPressureMmhg(peak.meanPressureKpa).systolic).toBeCloseTo(231.273, 2);
    expect(timeline.unconsciousAtSeconds).toBeNull();
  });
});

describe("患者の状態", () => {
  it("激痛の患者は、打つ前から心拍数が上がっていて、モルヒネで下がる", () => {
    const timeline = run(doses(["morphine", 0]), 600, { blood: 1, painHealth: 0.3 });
    expect(at(timeline, 0).heartRate).toBeCloseTo(130, 6);
    expect(at(timeline, 5).heartRate).toBeCloseTo(128.3137, 3);
    expect(at(timeline, 60).heartRate).toBeCloseTo(68.2399, 3);
    expect(at(timeline, 600).heartRate).toBeCloseTo(71.2799, 3);
    expect(bloodPressureMmhg(at(timeline, 0).meanPressureKpa).systolic).toBeCloseTo(194.995, 2);
  });

  it("血液が減っていると、同じ薬でも血圧が低い", () => {
    const timeline = run(doses(["phenylephrine", 0]), 200, { blood: 0.6, painHealth: 1 });
    expect(at(timeline, 0).meanPressureKpa).toBeCloseTo(7.4658, 4);
    expect(at(timeline, 30).meanPressureKpa).toBeCloseTo(10.96975, 4);
    expect(at(timeline, 30).heartRate).toBe(80);
    expect(timeline.unconsciousAtSeconds).toBeNull();
  });

  it("血液が 40% を下回ると、打つ前から意識がなく、頻脈になっている", () => {
    const timeline = run([], 30, { blood: 0.35, painHealth: 1 });
    expect(timeline.unconsciousAtSeconds).toBe(0);
    expect(timeline.arrestAtSeconds).toBeNull();
    expect(at(timeline, 0).heartRate).toBeCloseTo(177.3114, 3);
    expect(at(timeline, 30).meanPressureKpa).toBeCloseTo(9.6525, 4);
  });

  it("血液が 20% 以下なら、打つ前に心停止していて、点がない", () => {
    const timeline = run(doses(["epinephrine", 0]), 30, { blood: 0.2, painHealth: 1 });
    expect(timeline.arrestAtSeconds).toBe(0);
    expect(timeline.unconsciousAtSeconds).toBe(0);
    expect(timeline.points).toHaveLength(0);
  });
});

describe("過量投与", () => {
  it("エピネフリン 5 本は、平均血圧が 29.5 kPa を超えた時刻で心停止になり、線が止まる", () => {
    const timeline = run(
      Array.from({ length: 5 }, () => ({ drug: "epinephrine" as const, atMs: 0 })),
      300,
    );
    expect(timeline.arrestAtSeconds).toBe(15);
    expect(timeline.unconsciousAtSeconds).toBe(15);
    expect(timeline.points.at(-1)?.seconds).toBe(15);
    expect(timeline.points.at(-1)?.meanPressureKpa).toBeGreaterThan(29.5);
    expect(at(timeline, 14).meanPressureKpa).toBeLessThan(29.5);
    expect(at(timeline, 10).heartRate).toBeCloseTo(168.9947, 3);
  });

  it("メトプロロール 4 本は、先に意識を失い、その後で心停止になる", () => {
    const timeline = run(
      Array.from({ length: 4 }, () => ({ drug: "metoprolol" as const, atMs: 0 })),
      300,
    );
    expect(timeline.unconsciousAtSeconds).toBe(11);
    expect(timeline.arrestAtSeconds).toBe(13);
    expect(at(timeline, 10).heartRate).toBeCloseTo(36.0816, 3);
  });
});
