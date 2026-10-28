// メインのウィンドウの背景色（画面を描く前の一瞬に見える色）が、CSS の --background と同じことを確かめる。
// Rust（src-tauri/src/window/theme.rs）と tauri.conf.json は CSS を読めないので、sRGB の値を写してある
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseColor } from "@/test/color";
import { REPO_ROOT } from "@/test/samples";
import { THEME_VARIABLES } from "@/test/theme-css";

function hexOf(css: string): string {
  const { r, g, b } = parseColor(css);
  return [r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
}

function cssBackground(theme: keyof typeof THEME_VARIABLES): string {
  return hexOf(THEME_VARIABLES[theme]["background"] ?? "");
}

const themeRs = readFileSync(resolve(REPO_ROOT, "src-tauri", "src", "window", "theme.rs"), "utf8");

function rustBackground(name: string): string {
  const m = new RegExp(
    String.raw`${name}: Color = Color\(0x(\w\w), 0x(\w\w), 0x(\w\w), 0xff\)`,
  ).exec(themeRs);
  if (m === null) {
    throw new Error(`theme.rs に ${name} がありません`);
  }
  return `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`;
}

describe("メインのウィンドウの背景色", () => {
  it("theme.rs の色は CSS の --background と同じ", () => {
    expect(rustBackground("LIGHT_BACKGROUND")).toBe(cssBackground("light"));
    expect(rustBackground("DARK_BACKGROUND")).toBe(cssBackground("dark"));
  });

  it("tauri.conf.json の色（setup で変えるまでの値）はダークの --background と同じ", () => {
    const conf: unknown = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    expect(JSON.stringify(conf)).toContain(`"backgroundColor":"#${cssBackground("dark")}"`);
  });
});
