// デスクトップ版の src-tauri/src/db/text.rs のテストを移したもの。
import { describe, expect, it } from "vitest";

import { MAX_QUERY_CHARS } from "@/features/search/limits";
import { MARK_END, MARK_START } from "@/features/search/snippet";
import {
  compareNoCase,
  findCi,
  makeSnippet,
  MAX_TERMS,
  normalizeTags,
  splitTerms,
} from "@/web/backend/text";

describe("splitTerms", () => {
  it("半角と全角の空白で分け、大文字小文字だけ違う語をまとめる", () => {
    expect(splitTerms(" 止血帯　出血  cpr CPR ")).toEqual(["止血帯", "出血", "cpr"]);
    expect(splitTerms(" 　 ")).toEqual([]);
  });

  it("強調の目印を取り除く", () => {
    expect(splitTerms(`${MARK_START}出血${MARK_END}`)).toEqual(["出血"]);
  });

  it("語は先頭から MAX_TERMS 個までにする", () => {
    const query = Array.from({ length: MAX_TERMS + 5 }, (_, i) => `語${String(i)}`).join(" ");
    const terms = splitTerms(query);
    expect(terms).toHaveLength(MAX_TERMS);
    expect(terms[0]).toBe("語0");
  });

  it("先頭の MAX_QUERY_CHARS 文字だけを読む", () => {
    const terms = splitTerms("𠮷".repeat(MAX_QUERY_CHARS + 10));
    expect(terms).toHaveLength(1);
    expect(Array.from(terms[0] ?? "")).toHaveLength(MAX_QUERY_CHARS);
  });
});

describe("normalizeTags", () => {
  it("前後の空白と先頭の # を除き、空と大文字小文字だけの重複を捨てる", () => {
    expect(normalizeTags(["  #出血 ", "", "CPR", "cpr", "#"])).toEqual(["出血", "CPR"]);
  });
});

describe("findCi", () => {
  it("ASCII だけ大文字小文字を区別せずに探す", () => {
    const text = "止血帯（Tourniquet）";
    const found = findCi(text, "tourniquet");
    expect(found === null ? null : text.slice(found.start, found.end)).toBe("Tourniquet");
    expect(findCi(text, "出血")).toBeNull();
    expect(findCi(text, "")).toBeNull();
  });

  it("ASCII 以外の大文字小文字は区別する（SQLite の LIKE と同じ）", () => {
    expect(findCi("Ä", "ä")).toBeNull();
  });
});

describe("makeSnippet", () => {
  it("最初に当たった語を強調し、前後を省略する", () => {
    expect(makeSnippet("あいうえおかきくけこ出血さしすせそたちつてと", ["出血"], 3)).toBe(
      `…くけこ${MARK_START}出血${MARK_END}さしす…`,
    );
    expect(makeSnippet("短い本文", ["無関係"], 16)).toBe("短い本文");
  });

  it("本文になければ冒頭を返す", () => {
    expect(makeSnippet("あいうえおかきくけこ", ["無関係"], 2)).toBe("あいうえ…");
  });

  it("文字数はコードポイントで数える（サロゲートペアを分けない）", () => {
    expect(makeSnippet("𠀋𠀋𠀋出血𠀋𠀋𠀋", ["出血"], 2)).toBe(
      `…𠀋𠀋${MARK_START}出血${MARK_END}𠀋𠀋…`,
    );
  });
});

describe("compareNoCase", () => {
  it("ASCII の大文字小文字を同じとみなし、ほかは文字コードの順にする", () => {
    expect(["b", "A", "止血", "a"].sort(compareNoCase)).toEqual(["A", "a", "b", "止血"]);
  });
});
