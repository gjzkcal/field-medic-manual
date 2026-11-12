import { describe, expect, it } from "vitest";

import { overdoseLimit, SAFETY_MARGIN_MS, safeAtMs } from "@/features/casualties/overdose";
import { loadMedication } from "@/features/medication/bundle";
import type { OverdoseLine } from "@/features/medication/overdose-line";
import type { DrugId } from "@/features/medication/schema";

const medication = await loadMedication();
const T0 = 1_793_000_000_000;

/** 1 本打った直後から、何秒後に N 本を打てるか（長めの幅を除く） */
function secondsAfterOneDose(drug: DrugId, line: OverdoseLine, inPain: boolean): number {
  const limit = overdoseLimit(medication, drug, line, inPain);
  if (limit.kind !== "limit") {
    throw new Error(`本数の上限がありません: ${drug}`);
  }
  return (safeAtMs(medication, drug, [T0], limit) - SAFETY_MARGIN_MS - T0) / 1000;
}

describe("何本まで打てるか", () => {
  it("原稿の本数を下回る最大の整数", () => {
    expect(overdoseLimit(medication, "epinephrine", "unconscious", false)).toStrictEqual({
      kind: "limit",
      doses: 4,
      threshold: 4.36,
    });
    expect(overdoseLimit(medication, "epinephrine", "unconscious", true)).toMatchObject({
      doses: 2,
    });
    expect(overdoseLimit(medication, "morphine", "arrest", true)).toMatchObject({ doses: 3 });
  });

  it("メトプロロールは痛み・気胸ありでも、痛みなしの少ない本数を使う", () => {
    expect(overdoseLimit(medication, "metoprolol", "unconscious", true)).toMatchObject({
      doses: 2,
      threshold: 2.82,
    });
    expect(overdoseLimit(medication, "metoprolol", "arrest", true)).toMatchObject({
      doses: 3,
      threshold: 3.03,
    });
  });

  it("激痛のフェニレフリンは 1 本でも危ない", () => {
    expect(overdoseLimit(medication, "phenylephrine", "unconscious", true)).toStrictEqual({
      kind: "danger",
    });
    expect(overdoseLimit(medication, "phenylephrine", "arrest", false)).toMatchObject({
      doses: 2,
    });
  });

  it("ナロキソンには過量投与がない", () => {
    expect(overdoseLimit(medication, "naloxone", "arrest", true)).toStrictEqual({ kind: "none" });
  });
});

describe("N 本まで OK になる時刻", () => {
  // Issue #43 の「1 本打った後の計算の目安」の表（血液 100%）
  it.each([
    ["epinephrine", "unconscious", false, 53],
    ["epinephrine", "arrest", true, 53],
    ["phenylephrine", "arrest", false, 16],
    ["metoprolol", "unconscious", false, 22],
    ["metoprolol", "arrest", false, 139],
    ["morphine", "unconscious", true, 2592],
    ["morphine", "arrest", false, 244],
  ] as const)("%s %s 痛み %s: 1 本の後 %i s", (drug, line, inPain, seconds) => {
    expect(secondsAfterOneDose(drug, line, inPain)).toBe(seconds);
  });

  it("10 s 長めに出す", () => {
    const limit = overdoseLimit(medication, "epinephrine", "unconscious", false);
    if (limit.kind !== "limit") {
      throw new Error("本数の上限がありません");
    }
    expect(safeAtMs(medication, "epinephrine", [T0], limit)).toBe(T0 + 63_000);
  });

  it("前の分が多いほど遅くなる", () => {
    const limit = overdoseLimit(medication, "epinephrine", "unconscious", false);
    if (limit.kind !== "limit") {
      throw new Error("本数の上限がありません");
    }
    const one = safeAtMs(medication, "epinephrine", [T0], limit);
    const two = safeAtMs(medication, "epinephrine", [T0, T0], limit);
    expect(two).toBeGreaterThan(one);
  });

  it("体内から消えた分は数えない", () => {
    const limit = overdoseLimit(medication, "epinephrine", "unconscious", false);
    if (limit.kind !== "limit") {
      throw new Error("本数の上限がありません");
    }
    // エピネフリンは 164 s で消える
    expect(safeAtMs(medication, "epinephrine", [T0 - 200_000, T0], limit)).toBe(
      safeAtMs(medication, "epinephrine", [T0], limit),
    );
  });
});
