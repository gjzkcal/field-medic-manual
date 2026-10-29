// 画面の色が、ライト・ダークの両方で WCAG 2.2 AA のコントラストを満たすことを確かめる。
// 文字は 1.4.3（4.5:1）、入力欄の枠・フォーカスの輪・グラフの線・状態を示す色は 1.4.11（3:1）。
// 色は index.css の :root（ライト）と .dark、Tailwind の色は tailwindcss/theme.css から読む
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_OVERLAY_SETTINGS } from "@/features/settings/overlay-settings";
import { contrast, over, parseColor, type Rgba, withAlpha } from "@/test/color";
import { REPO_ROOT } from "@/test/samples";
import { THEME_VARIABLES } from "@/test/theme-css";

const TEXT = 4.5;
const NON_TEXT = 3;

const tailwind = readFileSync(
  resolve(REPO_ROOT, "node_modules", "tailwindcss", "theme.css"),
  "utf8",
);

function tw(name: string): Rgba {
  const value = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(tailwind)?.[1];
  if (value === undefined) {
    throw new Error(`Tailwind の色 ${name} がありません`);
  }
  return parseColor(value);
}

const THEMES = THEME_VARIABLES;

/** テーマごとに、Tailwind の色を使う部品のクラス（ライトの色 / dark: の色）。部品の側を変えたらここも合わせる */
const TAILWIND = {
  light: {
    severityText: ["emerald-700", "yellow-800", "orange-800", "red-700"],
    outcomeText: ["emerald-700", "amber-800", "red-700"],
    star: "amber-700",
  },
  dark: {
    severityText: ["emerald-300", "yellow-300", "orange-300", "red-300"],
    outcomeText: ["emerald-300", "amber-300", "red-300"],
    star: "amber-400",
  },
};
// src/features/quickref/severity.ts と src/features/triage/view/tone.ts の地の色（500 の色を薄く重ねる）
const SEVERITY_TINT = ["emerald-500", "yellow-500", "orange-500", "red-500"];
const OUTCOME_TINT = ["emerald-500", "amber-500", "red-500"];
const OVERLAY_OPACITY = DEFAULT_OVERLAY_SETTINGS.opacity / 100;
const ALERTS = ["note", "tip", "important", "warning", "caution"];

interface Pair {
  label: string;
  fg: Rgba;
  bg: Rgba;
  min: number;
}

function pairs(theme: keyof typeof THEMES): Pair[] {
  const vars = THEMES[theme];
  const c = (name: string): Rgba => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`--${name} がありません`);
    }
    return parseColor(value);
  };
  const background = c("background");
  const surface = (name: string): Rgba => over(c(name), background);
  const surfaces = ["background", "card", "popover", "muted", "accent", "secondary", "sidebar"];
  const list: Pair[] = [];
  const add = (label: string, fg: Rgba, bg: Rgba, min: number): void => {
    list.push({ label, fg, bg, min });
  };

  // 1.4.3 文字
  for (const s of surfaces) {
    add(`foreground / ${s}`, c("foreground"), surface(s), TEXT);
    add(`muted-foreground / ${s}`, c("muted-foreground"), surface(s), TEXT);
  }
  add("primary-foreground / primary", c("primary-foreground"), c("primary"), TEXT);
  add("secondary-foreground / secondary", c("secondary-foreground"), surface("secondary"), TEXT);
  add("accent-foreground / accent", c("accent-foreground"), surface("accent"), TEXT);
  add("sidebar-foreground / sidebar", c("sidebar-foreground"), surface("sidebar"), TEXT);
  add(
    "sidebar-accent-foreground / sidebar-accent",
    c("sidebar-accent-foreground"),
    surface("sidebar-accent"),
    TEXT,
  );
  for (const s of ["background", "card", "popover"]) {
    add(`destructive / ${s}`, c("destructive"), surface(s), TEXT);
    // 部品の destructive は地を薄く塗る（ライトは 10%、ダークは 20%）
    const tint = over(withAlpha(c("destructive"), theme === "dark" ? 0.2 : 0.1), surface(s));
    add(`destructive / destructive の地 (${s})`, c("destructive"), tint, TEXT);
  }
  // 小窓は背景を既定の不透明度（90%、src/features/settings/overlay-settings.ts）で塗り、後ろのゲームが透ける。
  // ゲームの画面はどんな色にもなるので、いちばん悪い白と黒の両方で測る
  for (const [name, game] of [
    ["白", parseColor("#ffffff")],
    ["黒", parseColor("#000000")],
  ] as const) {
    const overlay = over(withAlpha(background, OVERLAY_OPACITY), game);
    add(`foreground / 小窓の地（後ろが${name}）`, c("foreground"), overlay, TEXT);
    add(`muted-foreground / 小窓の地（後ろが${name}）`, c("muted-foreground"), overlay, TEXT);
  }
  for (const s of ["background", "popover"]) {
    // 検索欄（src/components/ui/command.tsx）は、ダークだけ地を input の 30% で塗る。案内の文字は muted-foreground
    const field = theme === "dark" ? over(withAlpha(c("input"), 0.3), surface(s)) : surface(s);
    add(`muted-foreground / 検索欄の地 (${s})`, c("muted-foreground"), field, TEXT);
    add(`foreground / 検索欄の地 (${s})`, c("foreground"), field, TEXT);
  }
  for (const s of ["background", "muted"]) {
    add(`manual-link / ${s}`, c("manual-link"), surface(s), TEXT);
  }
  for (const alert of ALERTS) {
    const color = c(`alert-${alert}`);
    const tint = over(withAlpha(color, 0.14), background);
    add(`Alert ${alert} の見出し / Alert の地`, color, tint, TEXT);
    add(`foreground / Alert ${alert} の地`, c("foreground"), tint, TEXT);
    add(`manual-link / Alert ${alert} の地`, c("manual-link"), tint, TEXT);
  }
  for (const s of ["background", "popover"]) {
    add(`foreground / search-hit (${s})`, c("foreground"), over(c("search-hit"), surface(s)), TEXT);
  }
  const tailwindColors = TAILWIND[theme];
  tailwindColors.severityText.forEach((text, i) => {
    const tint = over(withAlpha(tw(SEVERITY_TINT[i] ?? ""), 0.15), surface("card"));
    add(`重症度 ${text} / 地`, tw(text), tint, TEXT);
  });
  tailwindColors.outcomeText.forEach((text, i) => {
    const tint = over(withAlpha(tw(OUTCOME_TINT[i] ?? ""), 0.1), background);
    add(`トリアージの結果 ${text} / 地`, tw(text), tint, TEXT);
  });

  // 1.4.11 文字以外
  for (const s of ["background", "card", "popover", "muted"]) {
    add(`input（入力欄の枠・スクロールバー） / ${s}`, c("input"), surface(s), NON_TEXT);
    add(`ring 50%（フォーカスの輪） / ${s}`, withAlpha(c("ring"), 0.5), surface(s), NON_TEXT);
    add(`ring（フォーカスの枠） / ${s}`, c("ring"), surface(s), NON_TEXT);
  }
  add("ring 50% / accent", withAlpha(c("ring"), 0.5), surface("accent"), NON_TEXT);
  add(
    "sidebar-ring 50% / sidebar",
    withAlpha(c("sidebar-ring"), 0.5),
    surface("sidebar"),
    NON_TEXT,
  );
  add("primary（押したトグル） / background", c("primary"), background, NON_TEXT);
  add(
    "muted-foreground（フローチャートの線） / card",
    c("muted-foreground"),
    surface("card"),
    NON_TEXT,
  );
  for (const alert of ALERTS) {
    add(`Alert ${alert} の線 / background`, c(`alert-${alert}`), background, NON_TEXT);
  }
  for (const s of ["background", "popover"]) {
    add(`search-hit / ${s}`, over(c("search-hit"), surface(s)), surface(s), NON_TEXT);
  }
  for (let i = 1; i <= 5; i++) {
    for (const s of ["background", "card"]) {
      add(`chart-${String(i)} / ${s}`, c(`chart-${String(i)}`), surface(s), NON_TEXT);
    }
  }
  for (const s of ["background", "popover"]) {
    add(
      `お気に入りの星 ${tailwindColors.star} / ${s}`,
      tw(tailwindColors.star),
      surface(s),
      NON_TEXT,
    );
  }
  return list;
}

describe.each(["light", "dark"] as const)("%s のコントラスト（WCAG 2.2 AA）", (theme) => {
  it("文字は 4.5:1、文字以外は 3:1 以上", () => {
    const failures = pairs(theme)
      .map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) }))
      .filter((p) => p.ratio < p.min)
      .map((p) => `${p.label}: ${p.ratio.toFixed(2)} < ${String(p.min)}`);
    expect(failures).toEqual([]);
  });
});

describe("文字色の不透明度", () => {
  // 上の組み合わせは CSS 変数の色そのものしか見ないので、text-foreground/60 のように薄めた文字色は
  // 検査から漏れる（クイック表のタブがライトで 4.4:1 になり、Lighthouse で初めて見つかった）。
  // 薄い文字が要るときは、検査に入っている muted-foreground などの変数を使う
  it("部品の文字色に不透明度を付けない", () => {
    const fontSizes = new Set(["xs", "sm", "base", "lg", "xl"]);
    const src = resolve(REPO_ROOT, "src");
    const found = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
      .flatMap((file) =>
        [
          ...readFileSync(resolve(src, file), "utf8").matchAll(
            /\btext-([a-z][\w-]*)\/(?:\d+|\[[^\]]*\])/g,
          ),
        ]
          // text-sm/6 は文字の大きさと行の高さで、色ではない
          .filter((m) => m[1] !== undefined && !fontSizes.has(m[1]))
          .map((m) => `${file}: ${m[0]}`),
      );
    expect(found).toEqual([]);
  });
});

describe("parseColor", () => {
  it("白と黒のコントラストは 21:1", () => {
    expect(contrast(parseColor("#000000"), parseColor("oklch(1 0 0)"))).toBeCloseTo(21, 1);
  });

  it("OKLCH を sRGB に直す（Tailwind の red-500 は #fb2c36）", () => {
    const red = parseColor("oklch(63.7% 0.237 25.331)");
    expect(Math.round(red.r * 255)).toBe(0xfb);
    expect(Math.round(red.g * 255)).toBe(0x2c);
    expect(Math.round(red.b * 255)).toBe(0x36);
  });
});
