import { describe, expect, it } from "vitest";

import { parseQuickrefSettings } from "@/features/quickref/quickref-settings";

describe("parseQuickrefSettings", () => {
  it("保存した表示の形を読み、不正な値や未保存は既定のカードにする", () => {
    expect(parseQuickrefSettings({ view: "table" })).toEqual({ view: "table" });
    expect(parseQuickrefSettings({ view: "grid" })).toEqual({ view: "card" });
    expect(parseQuickrefSettings(null)).toEqual({ view: "card" });
    expect(parseQuickrefSettings("table")).toEqual({ view: "card" });
  });
});
