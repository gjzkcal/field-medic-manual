import { describe, expect, it } from "vitest";

import { expandTerm, parseSynonymSeed, SEED_SYNONYMS } from "@/web/backend/synonyms";

describe("同義語の初期値", () => {
  it("デスクトップ版のマイグレーションの SQL から 16 グループを読む", () => {
    const groups = new Set([...SEED_SYNONYMS.values()].map((terms) => terms.join("|")));
    expect(groups.size).toBe(16);
    // COLLATE NOCASE の並び（tourniquet < tq）
    expect(SEED_SYNONYMS.get("tq")).toEqual(["Tourniquet", "TQ", "ターニケット", "止血帯"]);
  });

  it("同義語に触れるマイグレーションは、表を作るものと初期値だけ", () => {
    // デスクトップ版で同義語を足したり消したりするマイグレーションが増えると、Web 版はそれを読まないので、ここで気づけるようにする
    const migrations = import.meta.glob<string>("/src-tauri/src/db/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const touching = Object.entries(migrations)
      .filter(([, sql]) => /synonym/i.test(sql))
      .map(([path]) => path.split("/").pop());
    expect(touching).toEqual(["0001_init.sql", "0002_seed_synonyms.sql"]);
  });

  it("引用符の中の 2 つ続きの引用符を 1 つに戻す", () => {
    const index = parseSynonymSeed(
      "INSERT INTO synonyms (group_id, term) VALUES (1, 'a''b'), (1, 'c');",
    );
    expect(index.get("c")).toEqual(["a'b", "c"]);
  });

  it("語を読めなければ失敗する", () => {
    expect(() => parseSynonymSeed("SELECT 1;")).toThrow();
  });
});

describe("expandTerm", () => {
  it("大文字小文字を区別せずに引き、入力した語を先頭にする", () => {
    expect(expandTerm("tq").alternatives).toEqual(["tq", "Tourniquet", "ターニケット", "止血帯"]);
  });

  it("3 文字以上の語には 3 文字未満の同義語を足さない", () => {
    expect(expandTerm("心停止").alternatives).not.toContain("CA");
    expect(expandTerm("CA").alternatives).toContain("心停止");
  });

  it("辞書にない語はそのまま", () => {
    expect(expandTerm("鯨")).toEqual({ original: "鯨", alternatives: ["鯨"] });
  });
});
