import { describe, expect, it } from "vitest";

import {
  activeMods,
  DEFAULT_MOD_SETTINGS,
  modSummary,
  parseModSettings,
  SELECTABLE_MODS,
  serializeModSettings,
} from "@/features/settings/mod-settings";

// RHS を足す前（2026-10）の保存は known を持たない
const ACE_MODS = ["hitzones", "circulation", "breathing", "ai"];

describe("parseModSettings", () => {
  it("既定は Circulation・Breathing・RHS（作者の普段の組み合わせ）", () => {
    expect(DEFAULT_MOD_SETTINGS).toEqual({ enabled: ["circulation", "breathing", "rhs"] });
    expect(parseModSettings(null)).toEqual(DEFAULT_MOD_SETTINGS);
    expect(parseModSettings({ enabled: "circulation" })).toEqual(DEFAULT_MOD_SETTINGS);
  });

  it("切り替えられない値と重複を捨て、決まった順に並べる", () => {
    expect(
      parseModSettings({
        enabled: ["breathing", "core", "x", "hitzones", "breathing", 1],
        known: SELECTABLE_MODS,
      }),
    ).toEqual({ enabled: ["hitzones", "breathing"] });
    // すべて切った状態（Core だけ）も保存できる
    expect(parseModSettings({ enabled: [], known: SELECTABLE_MODS })).toEqual({ enabled: [] });
  });

  it("known の無い古い保存は ACE の 4 つだけを知っている扱いにし、RHS は既定のありにする", () => {
    expect(parseModSettings({ enabled: ["circulation"] })).toEqual({
      enabled: ["circulation", "rhs"],
    });
    expect(parseModSettings({ enabled: [] })).toEqual({ enabled: ["rhs"] });
  });

  it("known にある MOD は保存のとおり（RHS を切った人は切ったまま）", () => {
    expect(parseModSettings({ enabled: ["circulation"], known: [...ACE_MODS, "rhs"] })).toEqual({
      enabled: ["circulation"],
    });
    // known にない MOD だけを既定の値にする
    expect(parseModSettings({ enabled: ["breathing"], known: ACE_MODS })).toEqual({
      enabled: ["breathing", "rhs"],
    });
  });
});

describe("serializeModSettings", () => {
  it("保存の時点で知っている MOD を known に入れる", () => {
    expect(serializeModSettings({ enabled: ["circulation"] })).toEqual({
      enabled: ["circulation"],
      known: [...SELECTABLE_MODS],
    });
  });
});

describe("activeMods", () => {
  it("Core と general は常に有効", () => {
    const mods = activeMods({ enabled: ["circulation"] });
    expect(mods.has("core")).toBe(true);
    expect(mods.has("general")).toBe(true);
    expect(mods.has("circulation")).toBe(true);
    expect(mods.has("breathing")).toBe(false);
    expect(mods.has("rhs")).toBe(false);
  });
});

describe("modSummary", () => {
  it("Core から順に表示名をつなぐ", () => {
    expect(modSummary(DEFAULT_MOD_SETTINGS)).toBe("Core + Circulation + Breathing + RHS");
    expect(modSummary({ enabled: [] })).toBe("Core");
  });
});
