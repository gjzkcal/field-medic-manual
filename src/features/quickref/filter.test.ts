import { describe, expect, it } from "vitest";

import {
  categoriesOf,
  filtersToParams,
  parseFilters,
  visibleRows,
  type QuickrefFilters,
} from "@/features/quickref/filter";
import { activeMods } from "@/features/settings/mod-settings";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";

function row(id: string, extra: Partial<QuickrefRow> = {}): QuickrefRow {
  return {
    id,
    category: "出血",
    symptom: id,
    severity: 4,
    treatment: ["包帯を巻く"],
    items: [],
    notes: null,
    links: [],
    mods: [],
    withoutMods: [],
    ...extra,
  };
}

const ROWS: QuickrefRow[] = [
  row("limb", { symptom: "手足の大出血", items: ["包帯"] }),
  row("ptx", { category: "気道・呼吸", symptom: "緊張性気胸", mods: ["breathing"], notes: "NCD" }),
  row("wake-ci", { category: "意識", severity: 3, mods: ["circulation"] }),
  row("wake-core", { category: "意識", severity: 3, withoutMods: ["circulation"] }),
  row("pain", { category: "薬・物品", severity: 1 }),
];

const NONE: QuickrefFilters = {
  category: null,
  severities: [],
  keyword: "",
  showAll: false,
  rowId: null,
};
const usual = activeMods({ enabled: ["circulation", "breathing"] });

function ids(filters: Partial<QuickrefFilters>, active = usual): string[] {
  return visibleRows(ROWS, { ...NONE, ...filters }, active).map((v) => v.row.id);
}

describe("parseFilters / filtersToParams", () => {
  it("URL のクエリと行き来する（既定値は書かない）", () => {
    const filters: QuickrefFilters = {
      category: "意識",
      severities: [4, 3],
      keyword: "NCD",
      showAll: true,
      rowId: "ptx",
    };
    const params = filtersToParams(filters);
    expect(params.toString()).toBe(
      new URLSearchParams({ cat: "意識", sev: "3,4", q: "NCD", all: "1", row: "ptx" }).toString(),
    );
    expect(parseFilters(params)).toEqual({ ...filters, severities: [3, 4] });
    expect(filtersToParams(NONE).toString()).toBe("");
  });

  it("不正な値は無視する", () => {
    expect(parseFilters(new URLSearchParams("sev=0,4,x,9&all=yes"))).toEqual({
      ...NONE,
      severities: [4],
    });
  });
});

describe("visibleRows", () => {
  it("使っている MOD に合う行だけを出し、「すべての組み合わせ」では全部を出す", () => {
    expect(ids({})).toEqual(["limb", "ptx", "wake-ci", "pain"]);
    expect(ids({}, activeMods({ enabled: [] }))).toEqual(["limb", "wake-core", "pain"]);
    expect(ids({ showAll: true })).toEqual(["limb", "ptx", "wake-ci", "wake-core", "pain"]);
  });

  it("カテゴリ・重症度・キーワードで絞る", () => {
    expect(ids({ category: "意識" })).toEqual(["wake-ci"]);
    expect(ids({ severities: [4] })).toEqual(["limb", "ptx"]);
    expect(ids({ severities: [1, 3] })).toEqual(["wake-ci", "pain"]);
    expect(ids({ keyword: "ncd" }), "備考も探す・大文字小文字を区別しない").toEqual(["ptx"]);
    expect(ids({ keyword: "包帯" }), "手順と物品も探す").toEqual([
      "limb",
      "ptx",
      "wake-ci",
      "pain",
    ]);
    expect(ids({ keyword: "大出血　手足" }), "空白で区切った語はすべて含む").toEqual(["limb"]);
  });

  it("行を指して開いたときは、絞り込みを外し、MOD で隠れる行でもその行は出す", () => {
    const result = visibleRows(
      ROWS,
      { ...NONE, rowId: "wake-core", severities: [1], category: "出血" },
      usual,
    );
    expect(result.map((v) => v.row.id)).toEqual(["limb", "ptx", "wake-ci", "wake-core", "pain"]);
    expect(result.find((v) => v.row.id === "wake-core")?.hiddenByMods).toBe(true);
    expect(result.find((v) => v.row.id === "limb")?.hiddenByMods).toBe(false);
  });
});

describe("categoriesOf", () => {
  it("ファイルに出てきた順に 1 回ずつ", () => {
    expect(categoriesOf(ROWS)).toEqual(["出血", "気道・呼吸", "意識", "薬・物品"]);
  });
});
