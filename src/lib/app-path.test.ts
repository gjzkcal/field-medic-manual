import { describe, expect, it } from "vitest";

import { isAppPath } from "@/lib/app-path";

describe("isAppPath", () => {
  it.each(["/", "/settings", "/doc/a%5Cb?hl=%E5%87%BA#x"])("%s はアプリ内のパス", (href) => {
    expect(isAppPath(href)).toBe(true);
  });

  it.each([
    "",
    "settings",
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/doc\n",
    `/${"a".repeat(4096)}`,
  ])("%s はアプリ内のパスではない", (href) => {
    expect(isAppPath(href)).toBe(false);
  });
});
