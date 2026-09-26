import { describe, expect, it } from "vitest";

import { DUMMY_SOURCE_PREFIX, makeDummyDocs } from "@/features/settings/debug/dummy";

describe("makeDummyDocs", () => {
  const docs = makeDummyDocs();
  const sections = docs.flatMap((d) => d.sections);

  it("1000 節を作り、sourcePath はダミーの印で始まり重ならない", () => {
    expect(sections).toHaveLength(1000);
    expect(new Set(docs.map((d) => d.sourcePath)).size).toBe(docs.length);
    expect(docs.every((d) => d.sourcePath?.startsWith(DUMMY_SOURCE_PREFIX) === true)).toBe(true);
  });

  it("文書の中でアンカーが重ならない", () => {
    for (const doc of docs) {
      expect(new Set(doc.sections.map((s) => s.anchor)).size).toBe(doc.sections.length);
    }
  });

  it("完了条件の確認に使う語を含み、処置として確定させない印を付ける", () => {
    const text = sections.map((s) => s.plainText).join("");
    for (const term of ["脈", "CPR", "止血帯", "止血"]) {
      expect(text).toContain(term);
    }
    expect(sections.every((s) => s.plainText.startsWith("【要確認】"))).toBe(true);
  });

  it("何度作っても同じ中身になる", () => {
    expect(makeDummyDocs()).toEqual(docs);
  });
});
