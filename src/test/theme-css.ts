// テストで index.css のテーマの色（:root がライト、.dark がダーク）を読む。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { REPO_ROOT } from "@/test/samples";

const css = readFileSync(resolve(REPO_ROOT, "src", "index.css"), "utf8");

function variables(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) {
    throw new Error(`index.css に ${selector} の節がありません`);
  }
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

const light = variables(":root");

/** テーマごとの CSS 変数（名前は -- を除いたもの） */
export const THEME_VARIABLES = {
  light,
  // .dark は :root を上書きするだけなので、書いていない変数は :root の値になる
  dark: { ...light, ...variables(".dark") },
};
