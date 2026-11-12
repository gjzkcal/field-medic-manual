import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  EMPTY_SEARCH_FILTER,
  parseSearchFilter,
  toQueryFilter,
} from "@/features/search/search-filter";

describe("parseSearchFilter", () => {
  it("正しい値はそのまま読む（モジュールは決まった並びに揃える）", () => {
    expect(
      parseSearchFilter({ modTargets: ["circulation", "core"], tags: ["出血"] }),
    ).toStrictEqual({
      modTargets: ["core", "circulation"],
      tags: ["出血"],
    });
  });

  it("不正な項目だけ既定値に戻す", () => {
    expect(parseSearchFilter({ modTargets: ["core", "manw", 1], tags: "出血" })).toStrictEqual({
      modTargets: ["core"],
      tags: [],
    });
  });

  it("以前の版で保存した版（modChannel）は読まず、検索にも渡さない", () => {
    const settings = parseSearchFilter({ modTargets: ["core"], modChannel: "release", tags: [] });
    expect(settings).toStrictEqual({ modTargets: ["core"], tags: [] });
    expect(toQueryFilter(settings)).toStrictEqual({ modTargets: ["core"] });
    expect(activeFilterCount(settings)).toBe(1);
  });

  it("タグの空白と重複を除く", () => {
    expect(parseSearchFilter({ tags: [" 出血 ", "出血", "", 3] }).tags).toStrictEqual(["出血"]);
  });

  it("保存されていない・形が違うときは絞り込みなし", () => {
    expect(parseSearchFilter(null)).toStrictEqual(EMPTY_SEARCH_FILTER);
    expect(parseSearchFilter("x")).toStrictEqual(EMPTY_SEARCH_FILTER);
  });
});

describe("toQueryFilter / activeFilterCount", () => {
  it("空の条件は search_query に渡さない", () => {
    expect(toQueryFilter(EMPTY_SEARCH_FILTER)).toStrictEqual({});
    expect(activeFilterCount(EMPTY_SEARCH_FILTER)).toBe(0);
  });

  it("指定した条件だけを渡し、数える", () => {
    const settings = { modTargets: ["core" as const], tags: ["a", "b"] };
    expect(toQueryFilter(settings)).toStrictEqual({ modTargets: ["core"], tags: ["a", "b"] });
    expect(activeFilterCount(settings)).toBe(3);
  });
});
