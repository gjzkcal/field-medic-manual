// 用語集の JSON Schema（content/glossary.v1.schema.json）を生成し、用語集がそれに合うことを確かめる。
// クイック表と同じく、テストの実行で生成物を書き出す（schema.ts を直したら pnpm test で作り直し、差分をコミットする）。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  GLOSSARY_SCHEMA_FILE,
  GLOSSARY_SCHEMA_ID,
  glossaryFileSchema,
} from "@/features/glossary/schema";
import { jsonSchemaText } from "@/lib/json-schema";
import { REPO_ROOT } from "@/test/samples";

const SCHEMA_PATH = resolve(REPO_ROOT, "content", GLOSSARY_SCHEMA_FILE);

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

describe("用語集の JSON Schema", () => {
  const text = jsonSchemaText(glossaryFileSchema);

  it("content/ に書き出す", () => {
    if (readOrNull(SCHEMA_PATH) !== text) {
      writeFileSync(SCHEMA_PATH, text);
    }
    expect(readOrNull(SCHEMA_PATH)).toBe(text);
  });

  it("用語集は、スキーマのファイルを $schema で指し、スキーマに合う（エディタでエラーが出ない）", () => {
    const value: unknown = parse(
      readFileSync(resolve(REPO_ROOT, "content", "glossary.yaml"), "utf8"),
    );
    expect(value).toMatchObject({ $schema: GLOSSARY_SCHEMA_ID });
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    validate(value);
    expect(validate.errors ?? []).toEqual([]);
  });

  it("書き間違いはスキーマでも見つかる", () => {
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    const term = {
      id: "cpr",
      mod: "circulation",
      kind: "action",
      en: "Perform CPR",
      ja: "心肺蘇生を行う",
    };
    const valid = {
      $schema: GLOSSARY_SCHEMA_ID,
      modChannel: "dev",
      verifiedAt: "2026-11-08",
      terms: [term],
    };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, terms: [{ ...term, kind: "verb" }] })).toBe(false);
    expect(validate({ ...valid, terms: [{ ...term, japanese: "typo" }] })).toBe(false);
    expect(validate({ ...valid, terms: [{ ...term, mod: "ai" }] })).toBe(false);
  });
});
