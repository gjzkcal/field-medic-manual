import { describe, expect, it } from "vitest";

import { EMPTY_FILTER, filterDocs, sortDocs } from "@/features/library/library-filter";
import type { DocMeta } from "@/lib/bindings/DocMeta";
import type { DocSummary } from "@/lib/bindings/DocSummary";

function doc(id: string, title: string, updatedAt: string, meta: Partial<DocMeta>): DocSummary {
  return {
    id,
    title,
    sourceType: "markdown",
    sourcePath: `bundle://manuals/${id}.md`,
    sourceHash: "h",
    meta: {
      modTarget: null,
      modChannel: null,
      modVersion: null,
      verifiedAt: "2026-09-25",
      tags: [],
      ...meta,
    },
    sectionCount: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

const NOW = new Date("2026-09-26T00:00:00Z");
const DOCS = [
  doc("a", "止血", "2026-09-20T00:00:00.000Z", { modTarget: "core", tags: ["出血", "止血帯"] }),
  doc("b", "心停止と CPR", "2026-09-25T00:00:00.000Z", {
    modTarget: "circulation",
    modChannel: "dev",
    tags: ["CPR"],
  }),
  doc("c", "気道", "2026-09-22T00:00:00.000Z", {
    modTarget: "breathing",
    modChannel: "release",
    verifiedAt: null,
  }),
];
const ids = (docs: readonly DocSummary[]): string[] => docs.map((d) => d.id);

describe("filterDocs", () => {
  it("条件がなければすべて", () => {
    expect(ids(filterDocs(DOCS, EMPTY_FILTER, NOW))).toEqual(["a", "b", "c"]);
  });

  it("モジュールはいずれかに当てはまるもの", () => {
    const filter = { ...EMPTY_FILTER, modTargets: ["core", "breathing"] as const };
    expect(ids(filterDocs(DOCS, filter, NOW))).toEqual(["a", "c"]);
  });

  it("版で絞っても、版を問わない原稿は残す", () => {
    expect(ids(filterDocs(DOCS, { ...EMPTY_FILTER, channel: "dev" }, NOW))).toEqual(["a", "b"]);
  });

  it("タグはすべてを持つもの", () => {
    expect(ids(filterDocs(DOCS, { ...EMPTY_FILTER, tags: ["出血", "止血帯"] }, NOW))).toEqual([
      "a",
    ]);
    expect(ids(filterDocs(DOCS, { ...EMPTY_FILTER, tags: ["出血", "CPR"] }, NOW))).toEqual([]);
  });

  it("古い内容だけ", () => {
    expect(ids(filterDocs(DOCS, { ...EMPTY_FILTER, staleOnly: true }, NOW))).toEqual(["c"]);
  });
});

describe("sortDocs", () => {
  it("更新日は新しい順", () => {
    expect(ids(sortDocs(DOCS, "updated"))).toEqual(["b", "c", "a"]);
  });

  it("タイトルは日本語の順で、元の配列は変えない", () => {
    const before = ids(DOCS);
    expect(sortDocs(DOCS, "title").map((d) => d.title)).toEqual(
      [...DOCS.map((d) => d.title)].sort(new Intl.Collator("ja").compare),
    );
    expect(ids(DOCS)).toEqual(before);
  });
});
