import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { VIEWER_SETTINGS_KEY } from "@/features/settings/viewer-settings";
import { LOCAL_SETTINGS_PREFIX } from "@/web/storage-keys";
import { THEME_BOOT_SCRIPT } from "@/web/theme-boot";

interface Run {
  /** localStorage に入っている文字列。undefined なら読もうとすると例外（プライベートブラウズなど） */
  stored: string | null | undefined;
  osDark: boolean;
}

/** <head> で動くのと同じく、ページの JS が何もない所でスクリプトだけを動かし、<html> のクラスを返す */
function run({ stored, osDark }: Run): string[] {
  const classes = new Set<string>();
  const keys: string[] = [];
  runInNewContext(THEME_BOOT_SCRIPT, {
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && osDark,
    }),
    localStorage: {
      getItem: (key: string) => {
        keys.push(key);
        if (stored === undefined) {
          throw new Error("SecurityError");
        }
        return stored;
      },
    },
    document: { documentElement: { classList: { add: (name: string) => classes.add(name) } } },
  });
  expect(keys.every((key) => key === LOCAL_SETTINGS_PREFIX + VIEWER_SETTINGS_KEY)).toBe(true);
  return [...classes];
}

describe("THEME_BOOT_SCRIPT", () => {
  it("保存したライト・ダークは OS によらずそのまま当てる", () => {
    expect(run({ stored: '{"theme":"dark"}', osDark: false })).toEqual(["dark"]);
    expect(run({ stored: '{"theme":"light"}', osDark: true })).toEqual([]);
  });

  it("システム・保存なし・壊れた値・読めないときは OS に合わせる", () => {
    for (const stored of [
      '{"theme":"system"}',
      null,
      "{",
      '"dark"',
      '{"theme":"sepia"}',
      undefined,
    ]) {
      expect(run({ stored, osDark: true })).toEqual(["dark"]);
      expect(run({ stored, osDark: false })).toEqual([]);
    }
  });
});
