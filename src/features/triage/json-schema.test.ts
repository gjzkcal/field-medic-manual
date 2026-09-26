// フローの JSON Schema（content/flows/triage-flow.v1.schema.json）を生成し、同梱のフローがそれに合うことを確かめる。
// ts-rs の bindings と同じく、テストの実行で生成物を書き出す（schema.ts を直したら pnpm test で作り直し、差分をコミットする）。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { bundledFlows } from "@/features/triage/bundle";
import { flowJsonSchemaText } from "@/features/triage/json-schema";
import { FLOW_SCHEMA_FILE, FLOW_SCHEMA_ID } from "@/features/triage/schema";
import { REPO_ROOT } from "@/test/samples";

const SCHEMA_PATH = resolve(REPO_ROOT, "content/flows", FLOW_SCHEMA_FILE);

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

describe("フローの JSON Schema", () => {
  const text = flowJsonSchemaText();

  it("content/flows/ に書き出す", () => {
    if (readOrNull(SCHEMA_PATH) !== text) {
      writeFileSync(SCHEMA_PATH, text);
    }
    expect(readOrNull(SCHEMA_PATH)).toBe(text);
  });

  it("エディタの補完に使う値の一覧と、知らないキーの禁止が入っている", () => {
    expect(text).toContain('"additionalProperties": false');
    for (const value of ["circulation", "release", "question", "critical", "danger", "ifMissing"]) {
      expect(text).toContain(`"${value}"`);
    }
  });

  it("同梱のフローは、スキーマのファイルを $schema で指し、スキーマに合う（エディタでエラーが出ない）", async () => {
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    for (const source of await bundledFlows()) {
      const value: unknown = source.fileName.endsWith(".json")
        ? JSON.parse(source.text)
        : parse(source.text);
      expect(value, source.fileName).toMatchObject({ $schema: FLOW_SCHEMA_ID });
      validate(value);
      expect(validate.errors ?? [], source.fileName).toEqual([]);
    }
  });

  it("書き間違いはスキーマでも見つかる", () => {
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(text));
    const valid = {
      $schema: FLOW_SCHEMA_ID,
      id: "a",
      title: "t",
      start: "e",
      nodes: { e: { type: "end", text: "e", outcome: "ok" } },
    };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, nodes: { e: { type: "end", text: "e", outcome: "fine" } } })).toBe(
      false,
    );
    expect(validate({ ...valid, modTarget: ["unknown"] })).toBe(false);
    expect(validate({ ...valid, titel: "typo" })).toBe(false);
    expect(
      validate({
        ...valid,
        nodes: { e: { type: "end", text: "e", outcome: "ok", links: ["doc:<documentId>"] } },
      }),
    ).toBe(false);
  });
});
