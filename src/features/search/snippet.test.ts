import { describe, expect, it } from "vitest";

import { MARK_END, MARK_START, splitSnippet } from "@/features/search/snippet";

describe("splitSnippet", () => {
  it("目印で囲まれた部分を強調として分ける", () => {
    expect(splitSnippet(`…四肢の大量${MARK_START}出血${MARK_END}には…`)).toEqual([
      { text: "…四肢の大量", hit: false, start: 0 },
      { text: "出血", hit: true, start: 7 },
      { text: "には…", hit: false, start: 10 },
    ]);
  });

  it("強調が複数・先頭・末尾にあっても分けられる", () => {
    const parts = splitSnippet(`${MARK_START}CPR${MARK_END} と ${MARK_START}心停止${MARK_END}`);
    expect(parts.map((p) => [p.text, p.hit])).toEqual([
      ["CPR", true],
      [" と ", false],
      ["心停止", true],
    ]);
  });

  it("目印がなければ全体を 1 つの部分にし、空なら何も返さない", () => {
    expect(splitSnippet("本文")).toEqual([{ text: "本文", hit: false, start: 0 }]);
    expect(splitSnippet("")).toEqual([]);
  });

  it("HTML のような文字列もそのまま文字として扱う", () => {
    expect(splitSnippet("<img src=x onerror=alert(1)>")).toEqual([
      { text: "<img src=x onerror=alert(1)>", hit: false, start: 0 },
    ]);
  });
});
