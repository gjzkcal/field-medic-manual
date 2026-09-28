import { describe, expect, it } from "vitest";

import { parseQuickref, QUICKREF_SCHEMA_ID, toQuickrefRows } from "@/features/quickref/schema";

function file(rows: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { $schema: QUICKREF_SCHEMA_ID, verifiedAt: "2026-09-28", rows, ...extra };
}

function row(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "limb-bleeding",
    category: "出血",
    symptom: "手足から大量に出血している",
    severity: "致命的",
    treatment: ["包帯を巻く"],
    links: ["doc:hemorrhage.md#包帯を巻く"],
    ...extra,
  };
}

function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

function messages(value: unknown): string[] {
  const result = parseQuickref(value);
  return result.ok ? [] : result.messages;
}

describe("parseQuickref", () => {
  it("正しいファイルを読み、DB に入れる行にする（重症度は 1〜4、省略は空）", () => {
    const result = parseQuickref(file([row()], { modChannel: "dev" }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.file.modChannel).toBe("dev");
    expect(toQuickrefRows(result.file)).toEqual([
      {
        id: "limb-bleeding",
        category: "出血",
        symptom: "手足から大量に出血している",
        severity: 4,
        treatment: ["包帯を巻く"],
        items: [],
        notes: null,
        links: ["doc:hemorrhage.md#包帯を巻く"],
        mods: [],
        withoutMods: [],
      },
    ]);
  });

  it("YAML の日付（Date）は YYYY-MM-DD の文字列にする", () => {
    const result = parseQuickref(file([row()], { verifiedAt: new Date("2026-09-28") }));
    expect(result.ok && result.file.verifiedAt).toBe("2026-09-28");
  });

  it("重症度は 4 つの言葉だけ", () => {
    const names = ["軽度", "中等度", "重度", "致命的"];
    names.forEach((severity, i) => {
      const result = parseQuickref(file([row({ severity })]));
      expect(result.ok && toQuickrefRows(result.file)[0]?.severity).toBe(i + 1);
    });
    expect(messages(file([row({ severity: "重篤" })]))[0]).toMatch(/^rows\.0\.severity: /);
    expect(messages(file([row({ severity: 4 })]))).not.toEqual([]);
  });

  it("必須項目の抜けはどこが抜けたかを返す", () => {
    for (const key of ["id", "category", "symptom", "severity", "treatment", "links"]) {
      expect(messages(file([omit(row(), key)])).join("\n"), key).toContain(`rows.0.${key}`);
    }
    expect(messages(omit(file([row()]), "verifiedAt")).join("\n")).toContain("verifiedAt");
    expect(messages(file([]))).not.toEqual([]);
  });

  it("空の手順・リンクと、知らないキーはエラー", () => {
    expect(messages(file([row({ treatment: [] })]))).not.toEqual([]);
    expect(messages(file([row({ treatment: [" "] })]))).not.toEqual([]);
    expect(messages(file([row({ links: [] })]))).not.toEqual([]);
    expect(messages(file([row({ note: "typo" })]))).not.toEqual([]);
    expect(messages({ ...file([row()]), title: "typo" })).not.toEqual([]);
  });

  it("id はスラッグで、重複しない", () => {
    expect(messages(file([row({ id: "Limb_Bleeding" })]))).not.toEqual([]);
    expect(messages(file([row(), row()])).join("\n")).toContain("重複");
  });

  it("カテゴリは決まった分類語だけ", () => {
    expect(messages(file([row({ category: "痛み" })]))).not.toEqual([]);
  });

  it("リンクの書式を確かめる", () => {
    expect(messages(file([row({ links: ["doc:<documentId>"] })]))).not.toEqual([]);
    expect(
      messages(file([row({ links: ["flow:casualty-first-contact", "quickref:other-row"] })])),
    ).toEqual([]);
  });

  it("MOD の条件は設定で選べる MOD だけで、mods と withoutMods は重ならない", () => {
    expect(messages(file([row({ mods: ["circulation"], withoutMods: ["breathing"] })]))).toEqual(
      [],
    );
    expect(messages(file([row({ withoutMods: ["core"] })]))).not.toEqual([]);
    expect(messages(file([row({ mods: ["general"] })]))).not.toEqual([]);
    expect(
      messages(file([row({ mods: ["circulation"], withoutMods: ["circulation"] })])).join("\n"),
    ).toContain("circulation");
  });
});
