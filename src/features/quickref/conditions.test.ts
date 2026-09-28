import { describe, expect, it } from "vitest";

import { conditionLabel, isRowVisible } from "@/features/quickref/conditions";
import { activeMods } from "@/features/settings/mod-settings";

const usual = activeMods({ enabled: ["circulation", "breathing"] });
const coreOnly = activeMods({ enabled: [] });

describe("isRowVisible", () => {
  it("条件のない行はいつも出る", () => {
    const row = { mods: [], withoutMods: [] };
    expect(isRowVisible(row, usual)).toBe(true);
    expect(isRowVisible(row, coreOnly)).toBe(true);
  });

  it("mods はすべて有効なときだけ出る", () => {
    const row = { mods: ["circulation", "breathing"] as const, withoutMods: [] };
    expect(isRowVisible(row, usual)).toBe(true);
    expect(isRowVisible(row, activeMods({ enabled: ["circulation"] }))).toBe(false);
    expect(isRowVisible(row, coreOnly)).toBe(false);
  });

  it("withoutMods はどれも無効なときだけ出る", () => {
    const row = { mods: [], withoutMods: ["circulation"] as const };
    expect(isRowVisible(row, usual)).toBe(false);
    expect(isRowVisible(row, activeMods({ enabled: ["breathing"] }))).toBe(true);
    expect(isRowVisible(row, coreOnly)).toBe(true);
  });
});

describe("conditionLabel", () => {
  it("条件を「Circulation あり・Breathing なし」の形にする", () => {
    expect(conditionLabel({ mods: [], withoutMods: [] })).toBeNull();
    expect(conditionLabel({ mods: ["circulation"], withoutMods: ["breathing"] })).toBe(
      "Circulation あり・Breathing なし",
    );
  });
});
