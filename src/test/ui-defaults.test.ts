// shadcn から入れた部品の既定の見た目と文言のうち、このアプリで変えたものが、部品の更新で戻らないことを確かめる。
// 画面に描いて確かめにくいもの（既定の文言、ホバーしていないときの下線、案内の文字の色）を、ソースで見る
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "@/test/samples";

const UI = resolve(REPO_ROOT, "src", "components", "ui");

function source(file: string): string {
  return readFileSync(resolve(UI, file), "utf8");
}

describe("部品の既定の文言", () => {
  it("読み上げや既定の中身に、英語の文言を残さない", () => {
    // 名前（aria-label）、読み上げ専用の文字（sr-only）、中身を渡さなかったときの既定（{children ?? "…"}）、引数の既定値（title = "…"）
    const english = [
      /aria-label="[A-Za-z][A-Za-z .]*"/u,
      /sr-only">\s*[A-Za-z]/u,
      /\{children \?\? "[A-Za-z][A-Za-z .]*"\}/u,
      /\b(?:title|description|label|placeholder) = "[A-Za-z][A-Za-z .]*"/u,
      /\? "[A-Za-z][a-z]+ [a-z ]+" : "[A-Za-z]/u,
    ];
    const found = readdirSync(UI)
      .filter((file) => file.endsWith(".tsx"))
      .flatMap((file) =>
        source(file)
          .split("\n")
          .filter((line) => english.some((pattern) => pattern.test(line)))
          .map((line) => `${file}: ${line.trim()}`),
      );
    expect(found).toStrictEqual([]);
  });
});

describe("部品の既定の見た目", () => {
  it("リンクの見た目のボタンは、ホバーしていなくても下線を出す", () => {
    const link = /link:\s*"([^"]+)"/u.exec(source("button.tsx"))?.[1] ?? "";
    expect(link.split(" ")).toContain("underline");
  });

  it("動きを減らす設定でも、待っている合図（スピナーとスケルトン）は止めない", () => {
    // CSS は data-slot で部品を選ぶ。部品の更新で data-slot が変わると、合図がまた止まる
    const css = readFileSync(resolve(REPO_ROOT, "src", "index.css"), "utf8");
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}\n/u.exec(
      css,
    )?.[1];
    expect(reduced).toMatch(
      /\[data-slot="spinner"\],\s*\[data-slot="skeleton"\] \{\s*animation: loading-fade [^;]*infinite !important;/u,
    );
    expect(css).toContain("@keyframes loading-fade");
    expect(source("spinner.tsx")).toContain('data-slot="spinner"');
    expect(source("skeleton.tsx")).toContain('data-slot="skeleton"');
  });

  it("検索欄の案内の文字は、不透明の色にする", () => {
    // 指定しないと文字色の 50% になり、4.5:1 に届かない。色の組み合わせは contrast.test.ts で測っている
    expect(source("command.tsx")).toContain("placeholder:text-muted-foreground");
  });
});
