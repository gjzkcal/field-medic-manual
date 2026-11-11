import { describe, expect, it } from "vitest";

import { toCasualtyOp } from "@/features/casualties/casualty-store";
import { casualtyBrief, spokenDuration } from "@/features/chat/casualty-brief";
import { describeOps } from "@/features/chat/proposal-view";
import { loadMedication } from "@/features/medication/bundle";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { ProposedOp } from "@/lib/bindings/ProposedOp";

const medication = await loadMedication();
const NOW = 1_793_000_000_000;
const S = 1000;

const A: Casualty = {
  id: "c1",
  name: "A",
  createdAtMs: NOW - 600 * S,
  inPain: true,
  records: [
    { id: "r1", atMs: NOW - 120 * S, entry: { kind: "drug", drug: "morphine" } },
    { id: "r2", atMs: NOW - 60 * S, entry: { kind: "tourniquet_on", site: "left_arm" } },
    { id: "r3", atMs: NOW - 10 * S, entry: { kind: "saline" } },
  ],
};

describe("casualtyBrief", () => {
  it("記録と、画面と同じ計算の薬の効き・過量投与・止血帯・生理食塩水を出す", () => {
    const text = casualtyBrief({
      casualties: [A],
      medication,
      circulation: true,
      overdoseLine: "unconscious",
      nowMs: NOW,
    });
    expect(text).toContain("## 負傷者「A」（id: c1）");
    expect(text).toContain("痛み・気胸: あり");
    expect(text).toContain("- [r1] 2 分 0 秒 前 モルヒネ");
    expect(text).toContain("- [r2] 1 分 0 秒 前 止血帯を巻いた（左腕）");
    expect(text).toMatch(/- モルヒネ（1 本、最後は 2 分 0 秒 前）: 鎮痛 /);
    expect(text).toMatch(/過量投与: /);
    expect(text).toMatch(/生理食塩水: 入れ終わるまで /);
    expect(text).toContain("巻いている止血帯: 左腕（1 分 0 秒 前から）");
  });

  it("Circulation なしでは、薬の効きではなく次を打てるまでを出す", () => {
    const text = casualtyBrief({
      casualties: [A],
      medication,
      circulation: false,
      overdoseLine: "unconscious",
      nowMs: NOW - 119 * S,
    });
    expect(text).not.toContain("今効いている薬");
    expect(text).toMatch(/モルヒネ: 次を打てるまで /);
  });

  it("負傷者がいなければ、そう書く", () => {
    expect(
      casualtyBrief({
        casualties: [],
        medication,
        circulation: true,
        overdoseLine: "arrest",
        nowMs: NOW,
      }),
    ).toContain("負傷者は記録されていません");
  });

  it("時間は単位を付けて書く", () => {
    expect(spokenDuration(5 * S)).toBe("5 秒");
    expect(spokenDuration(192 * S)).toBe("3 分 12 秒");
    expect(spokenDuration(-1)).toBe("0 秒");
  });
});

describe("提案の操作", () => {
  const ops: ProposedOp[] = [
    { action: "add_casualty", name: "B" },
    { action: "give_drug", casualty: "new", drug: "epinephrine" },
    { action: "set_pain", casualty: "c1", pain: false },
    { action: "remove_record", casualty: "c1", record: "r9" },
    { action: "clear_all" },
  ];

  it("カードには負傷者を名前で出し、消す操作と見つからないものに印を付ける", () => {
    expect(describeOps(ops, [A])).toEqual([
      { text: "負傷者「B」を追加", destructive: false, missing: false },
      { text: "新しい負傷者「B」に記録: エピネフリン", destructive: false, missing: false },
      { text: "「A」の痛み・気胸を「なし」にする", destructive: false, missing: false },
      { text: "「A」の記録を消す（見つからない記録）", destructive: true, missing: true },
      { text: "すべての負傷者と記録を消す", destructive: true, missing: false },
    ]);
  });

  it("記録の操作にするとき、new を作った負傷者の id に、空の名前を「負傷者 N」にする", () => {
    expect(toCasualtyOp({ action: "add_casualty", name: " " }, null, [A])).toEqual({
      op: "add_casualty",
      name: "負傷者 1",
    });
    expect(toCasualtyOp(ops[1] ?? { action: "clear_all" }, "c2", [A])).toEqual({
      op: "add_record",
      casualtyId: "c2",
      entry: { kind: "drug", drug: "epinephrine" },
    });
    expect(toCasualtyOp({ action: "set_pain", casualty: "c1", pain: true }, null, [A])).toEqual({
      op: "set_pain",
      casualtyId: "c1",
      inPain: true,
    });
  });
});
