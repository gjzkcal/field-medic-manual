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
      parseSearchFilter({ modTargets: ["circulation", "core"], modChannel: "dev", tags: ["出血"] }),
    ).toEqual({ modTargets: ["core", "circulation"], modChannel: "dev", tags: ["出血"] });
  });

  it("不正な項目だけ既定値に戻す", () => {
    expect(
      parseSearchFilter({ modTargets: ["core", "manw", 1], modChannel: "manw", tags: "出血" }),
    ).toEqual({ modTargets: ["core"], modChannel: null, tags: [] });
  });

  it("タグの空白と重複を除く", () => {
    expect(parseSearchFilter({ tags: [" 出血 ", "出血", "", 3] }).tags).toEqual(["出血"]);
  });

  it("保存されていない・形が違うときは絞り込みなし", () => {
    expect(parseSearchFilter(null)).toEqual(EMPTY_SEARCH_FILTER);
    expect(parseSearchFilter("x")).toEqual(EMPTY_SEARCH_FILTER);
  });
});

describe("toQueryFilter / activeFilterCount", () => {
  it("空の条件は search_query に渡さない", () => {
    expect(toQueryFilter(EMPTY_SEARCH_FILTER)).toEqual({});
    expect(activeFilterCount(EMPTY_SEARCH_FILTER)).toBe(0);
  });

  it("指定した条件だけを渡し、数える", () => {
    const settings = { modTargets: ["core" as const], modChannel: null, tags: ["a", "b"] };
    expect(toQueryFilter(settings)).toEqual({ modTargets: ["core"], tags: ["a", "b"] });
    expect(activeFilterCount(settings)).toBe(3);
  });
});
