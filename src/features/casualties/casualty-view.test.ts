import { describe, expect, it } from "vitest";

import {
  activeTourniquets,
  ammoniumTimes,
  dosesOf,
  lastDoseAtMs,
  lastSalineAtMs,
  nextCasualtyName,
} from "@/features/casualties/casualty-view";
import { entryLabel, formatDuration } from "@/features/casualties/labels";
import type { CasualtyEntry } from "@/lib/bindings/CasualtyEntry";
import type { CasualtyRecord } from "@/lib/bindings/CasualtyRecord";

function records(...entries: [number, CasualtyEntry][]): CasualtyRecord[] {
  return entries.map(([atMs, entry], i) => ({ id: String(i), atMs, entry }));
}

describe("記録の整理", () => {
  it("濃度の仕組みがある薬だけを投与にする", () => {
    const list = records(
      [1, { kind: "drug", drug: "epinephrine" }],
      [2, { kind: "drug", drug: "ammonium_carbonate" }],
      [3, { kind: "saline" }],
    );
    expect(dosesOf(list)).toStrictEqual([{ drug: "epinephrine", atMs: 1 }]);
    expect(ammoniumTimes(list)).toStrictEqual([2]);
  });

  it("止血帯は外すと消え、巻き直すと新しい時刻になる", () => {
    const list = records(
      [1, { kind: "tourniquet_on", site: "left_arm" }],
      [2, { kind: "tourniquet_on", site: "right_leg" }],
      [3, { kind: "tourniquet_off", site: "left_arm" }],
      [4, { kind: "tourniquet_on", site: "left_arm" }],
      [5, { kind: "tourniquet_off", site: "right_leg" }],
    );
    expect(activeTourniquets(list)).toStrictEqual([{ site: "left_arm", sinceMs: 4 }]);
  });

  it("生理食塩水と薬は最後の時刻を返す", () => {
    const list = records(
      [1, { kind: "saline" }],
      [2, { kind: "saline" }],
      [3, { kind: "drug", drug: "morphine" }],
    );
    expect(lastSalineAtMs(list)).toBe(2);
    expect(lastDoseAtMs(list, "morphine")).toBe(3);
    expect(lastDoseAtMs(list, "epinephrine")).toBeNull();
    expect(lastSalineAtMs([])).toBeNull();
  });
});

describe("nextCasualtyName", () => {
  it("空いている最小の番号にする", () => {
    expect(nextCasualtyName([])).toBe("負傷者 1");
    expect(nextCasualtyName(["負傷者 1", "負傷者 3", "田中"])).toBe("負傷者 2");
  });
});

describe("表示", () => {
  it("60 s までは秒、それより長いときは分と秒", () => {
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(44_100)).toBe("45 s");
    expect(formatDuration(60_000)).toBe("60 s");
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(492_000)).toBe("8:12");
    expect(formatDuration(-5000)).toBe("0 s");
  });

  it("記録の 1 行に部位とメモを出す", () => {
    expect(entryLabel({ kind: "tourniquet_on", site: "left_leg" })).toBe("止血帯を巻いた（左脚）");
    expect(entryLabel({ kind: "note", text: "右胸に傷" })).toBe("メモ: 右胸に傷");
  });
});
