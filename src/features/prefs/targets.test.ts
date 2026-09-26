import { describe, expect, it } from "vitest";

import { prefHref, prefKey, samePrefTarget } from "@/features/prefs/targets";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";

const SECTION: PrefTarget = { kind: "section", documentId: "d1", anchor: "止血帯を使う" };
const DOCUMENT: PrefTarget = { kind: "document", documentId: "d1" };
const FLOW: PrefTarget = { kind: "flow", flowId: "first-contact" };

describe("prefHref", () => {
  it("節はアンカー付きのビューア、文書はビューア、フローは実行画面を開く", () => {
    expect(prefHref(SECTION)).toBe(`/doc/d1#${encodeURIComponent("止血帯を使う")}`);
    expect(prefHref(DOCUMENT)).toBe("/doc/d1");
    expect(prefHref(FLOW)).toBe("/triage/first-contact");
  });
});

describe("prefKey", () => {
  it("種類が違えば同じ id でも別のキーになる", () => {
    const keys = [SECTION, DOCUMENT, FLOW, { kind: "flow", flowId: "d1" } satisfies PrefTarget].map(
      prefKey,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("同じ対象は同じキーになる", () => {
    expect(samePrefTarget(SECTION, { ...SECTION })).toBe(true);
    expect(samePrefTarget(SECTION, { ...SECTION, anchor: "別" })).toBe(false);
  });
});
