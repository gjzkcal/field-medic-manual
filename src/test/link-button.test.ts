// 画面を移るリンクを Button（Base UI）で描かないことを確かめる。
// Button に nativeButton={false} で Link や a を渡すと role="button" が付き、読み上げでリンクがボタンと伝わる（WCAG 4.1.2）。
// ボタンの見た目のリンクは src/components/LinkButton.tsx を使う
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "@/test/samples";

describe("ボタンの見た目のリンク", () => {
  it("Button に nativeButton={false} を付けない（LinkButton を使う）", () => {
    const src = resolve(REPO_ROOT, "src");
    const found = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx") && !file.endsWith("LinkButton.tsx"))
      .filter((file) => readFileSync(resolve(src, file), "utf8").includes("nativeButton={false}"));
    expect(found).toEqual([]);
  });
});
