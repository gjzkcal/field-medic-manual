// クイック表の JSON Schema（content/quickref.v1.schema.json）を生成し、同梱のクイック表がそれに合うことを確かめる。
// フローと同じく、テストの実行で生成物を書き出す（schema.ts を直したら pnpm test で作り直し、差分をコミットする）。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { bundledQuickref } from "@/features/quickref/bundle";
import {
  QUICKREF_SCHEMA_FILE,
  QUICKREF_SCHEMA_ID,
  quickrefFileSchema,
} from "@/features/quickref/schema";
import { jsonSchemaText } from "@/lib/json-schema";
import { REPO_ROOT } from "@/test/samples";

const SCHEMA_PATH = resolve(REPO_ROOT, "content", QUICKREF_SCHEMA_FILE);

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

describe("クイック表の JSON Schema", () => {
  const text = jsonSchemaText(quickrefFileSchema);

  it("content/ に書き出す", () => {
    if (readOrNull(SCHEMA_PATH) !== text) {
      writeFileSync(SCHEMA_PATH, text);
    }
    expect(readOrNull(SCHEMA_PATH)).toBe(text);
  });

  it("エディタの補完に使う値の一覧と、知らないキーの禁止が入っている", () => {
    expect(text).toContain('"additionalProperties": false');
    for (const value of ["致命的", "気道・呼吸", "circulation", "withoutMods", "release"]) {
      expect(text).toContain(`"${value}"`);
    }
  });

  it("同梱のクイック表は、スキーマのファイルを $schema で指し、スキーマに合う（エディタでエラーが出ない）", async () => {
    const source = await bundledQuickref();
    expect(source).not.toBeNull();
    const value: unknown = parse(source?.text ?? "");
    expect(value).toMatchObject({ $schema: QUICKREF_SCHEMA_ID });
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    validate(value);
    expect(validate.errors ?? []).toEqual([]);
  });

  it("書き間違いはスキーマでも見つかる", () => {
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    const row = {
      id: "a",
      category: "出血",
      symptom: "s",
      severity: "軽度",
      treatment: ["t"],
      links: ["doc:hemorrhage.md"],
    };
    const valid = { $schema: QUICKREF_SCHEMA_ID, verifiedAt: "2026-09-28", rows: [row] };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, rows: [{ ...row, severity: "重篤" }] })).toBe(false);
    expect(validate({ ...valid, rows: [{ ...row, note: "typo" }] })).toBe(false);
    expect(validate({ ...valid, rows: [{ ...row, withoutMods: ["core"] }] })).toBe(false);
    expect(validate({ ...valid, rows: [{ ...row, links: ["doc:<documentId>"] }] })).toBe(false);
  });
});
