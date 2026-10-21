import { describe, expect, it } from "vitest";

import {
  activeMods,
  DEFAULT_MOD_SETTINGS,
  modSummary,
  parseModSettings,
} from "@/features/settings/mod-settings";

describe("parseModSettings", () => {
  it("既定は Circulation と Breathing（作者の普段の組み合わせ）", () => {
    expect(DEFAULT_MOD_SETTINGS).toEqual({ enabled: ["circulation", "breathing"] });
    expect(parseModSettings(null)).toEqual(DEFAULT_MOD_SETTINGS);
    expect(parseModSettings({ enabled: "circulation" })).toEqual(DEFAULT_MOD_SETTINGS);
  });

  it("切り替えられない値と重複を捨て、決まった順に並べる", () => {
    expect(
      parseModSettings({ enabled: ["breathing", "core", "x", "hitzones", "breathing", 1] }),
    ).toEqual({ enabled: ["hitzones", "breathing"] });
    // すべて切った状態（Core だけ）も保存できる
    expect(parseModSettings({ enabled: [] })).toEqual({ enabled: [] });
  });
});

describe("activeMods", () => {
  it("Core と general は常に有効", () => {
    const mods = activeMods({ enabled: ["circulation"] });
    expect(mods.has("core")).toBe(true);
    expect(mods.has("general")).toBe(true);
    expect(mods.has("circulation")).toBe(true);
    expect(mods.has("breathing")).toBe(false);
  });
});

describe("modSummary", () => {
  it("Core から順に表示名をつなぐ", () => {
    expect(modSummary(DEFAULT_MOD_SETTINGS)).toBe("Core + Circulation + Breathing");
    expect(modSummary({ enabled: [] })).toBe("Core");
  });
});
