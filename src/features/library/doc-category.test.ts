import { describe, expect, it } from "vitest";

import { categoryLabel, groupByCategory } from "@/features/library/doc-category";

function doc(
  id: string,
  category: string | null,
): { id: string; meta: { category: string | null } } {
  return { id, meta: { category } };
}

function ids(groups: ReturnType<typeof groupByCategory<ReturnType<typeof doc>>>): unknown {
  return groups.map((g) => [g.category, g.items.map((d) => d.id)]);
}

describe("groupByCategory", () => {
  it("並んだ順に最初に出た分類の順でまとめ、分類の中は元の順を保つ", () => {
    const groups = groupByCategory([
      doc("about", "はじめに"),
      doc("bleeding", "症状/処置"),
      doc("airway", "症状/処置"),
      doc("pain", "薬学/物品"),
    ]);
    expect(ids(groups)).toEqual([
      ["はじめに", ["about"]],
      ["症状/処置", ["bleeding", "airway"]],
      ["薬学/物品", ["pain"]],
    ]);
  });

  it("途切れて並んだ同じ分類は、最初に出た位置にまとめる", () => {
    const groups = groupByCategory([doc("a", "X"), doc("b", "Y"), doc("c", "X")]);
    expect(ids(groups)).toEqual([
      ["X", ["a", "c"]],
      ["Y", ["b"]],
    ]);
  });

  it("分類のないものは位置にかかわらず末尾にまとめる", () => {
    const groups = groupByCategory([doc("a", null), doc("b", "X"), doc("c", null)]);
    expect(ids(groups)).toEqual([
      ["X", ["b"]],
      [null, ["a", "c"]],
    ]);
  });

  it("空の入力は空", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("categoryLabel", () => {
  it("分類のないものは「その他」", () => {
    expect(categoryLabel(null)).toBe("その他");
    expect(categoryLabel("はじめに")).toBe("はじめに");
  });
});
