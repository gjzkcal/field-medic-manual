// 薬の数値の JSON Schema（content/medication.v1.schema.json）を生成し、同梱のファイルがそれに合うことを確かめる。
// クイック表と同じく、テストの実行で生成物を書き出す（schema.ts を直したら pnpm test で作り直し、差分をコミットする）。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  MEDICATION_SCHEMA_FILE,
  MEDICATION_SCHEMA_ID,
  medicationFileSchema,
} from "@/features/medication/schema";
import { jsonSchemaText } from "@/lib/json-schema";
import { REPO_ROOT } from "@/test/samples";

const SCHEMA_PATH = resolve(REPO_ROOT, "content", MEDICATION_SCHEMA_FILE);
const YAML_PATH = resolve(REPO_ROOT, "content", "medication.yaml");

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

describe("薬の数値の JSON Schema", () => {
  const text = jsonSchemaText(medicationFileSchema);

  it("content/ に書き出す", () => {
    if (readOrNull(SCHEMA_PATH) !== text) {
      writeFileSync(SCHEMA_PATH, text);
    }
    expect(readOrNull(SCHEMA_PATH)).toBe(text);
  });

  it("同梱のファイルは、スキーマのファイルを $schema で指し、スキーマに合う", () => {
    const value: unknown = parse(readFileSync(YAML_PATH, "utf8"));
    expect(value).toMatchObject({ $schema: MEDICATION_SCHEMA_ID });
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    validate(value);
    expect(validate.errors ?? []).toStrictEqual([]);
  });

  it("書き間違いはスキーマでも見つかる", () => {
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    const value: unknown = parse(readFileSync(YAML_PATH, "utf8"));
    if (typeof value !== "object") {
      throw new TypeError("YAML を読めません");
    }
    expect(validate({ ...value, typo: 1 })).toBe(false);
    expect(validate({ ...value, salineSeconds: -1 })).toBe(false);
  });
});
