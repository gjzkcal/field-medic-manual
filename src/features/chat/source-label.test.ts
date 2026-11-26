import { describe, expect, it } from "vitest";

import { sourceKind, sourceLabel, type SourceLookups } from "@/features/chat/source-label";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";

const DOC: DocOutline = {
  id: "d1",
  title: "痛みと抑え方",
  sourcePath: "bundle://manuals/pain.md",
  meta: {
    modTarget: "core",
    modChannel: null,
    modVersion: null,
    verifiedAt: null,
    aceCommit: null,
    gameVersion: null,
    tags: [],
    order: null,
    category: null,
  },
  headings: [
    {
      level: 2,
      title: "Circulation を入れている場合",
      anchor: "circulation-を入れている場合",
      mods: [],
      withoutMods: [],
      hasBody: true,
    },
  ],
};

const ROW: QuickrefRow = {
  id: "limb-bleeding",
  category: "出血",
  symptom: "手足から大量に出血している",
  severity: 4,
  treatment: [],
  items: [],
  notes: null,
  links: [],
  mods: [],
  withoutMods: [],
};

const FLOW: TriageSummary = {
  id: "massive-bleeding",
  title: "出血を止める",
  description: null,
  modTargets: [],
  modChannel: null,
  verifiedAt: null,
  version: 1,
  sourceHash: "h",
  updatedAt: "2026-01-01T00:00:00Z",
};

const LOOKUPS: SourceLookups = { outline: [DOC], quickrefRows: [ROW], flows: [FLOW] };
const EMPTY: SourceLookups = { outline: [], quickrefRows: [], flows: [] };

describe("sourceLabel", () => {
  it("節は、アンカーではなくマニュアルの名前と見出しで出す", () => {
    expect(sourceLabel("doc:pain.md#circulation-を入れている場合", LOOKUPS)).toBe(
      "痛みと抑え方 › Circulation を入れている場合",
    );
    expect(sourceLabel("doc:pain.md", LOOKUPS)).toBe("痛みと抑え方");
  });

  it("クイック表とフローは、id ではなく症状と題名で出す", () => {
    expect(sourceLabel("quickref:limb-bleeding", LOOKUPS)).toBe(
      "クイック表 › 手足から大量に出血している",
    );
    expect(sourceLabel("flow:massive-bleeding", LOOKUPS)).toBe("フロー › 出血を止める");
  });

  it("一覧に見つからないものは、渡された書式から分かる範囲で出す", () => {
    // 見出しだけが見つからない（AI が存在しない節を指した）
    expect(sourceLabel("doc:pain.md#無い節", LOOKUPS)).toBe("痛みと抑え方 › 無い節");
    // 一覧をまだ読めていない。ファイル名を残して、別のマニュアルの同じ名前の節と見分けられるようにする
    expect(sourceLabel("doc:pain.md#概要", EMPTY)).toBe("pain.md › 概要");
    expect(sourceLabel("doc:bleeding.md#概要", EMPTY)).toBe("bleeding.md › 概要");
    expect(sourceLabel("doc:pain.md", EMPTY)).toBe("pain.md");
    expect(sourceLabel("quickref:limb-bleeding", EMPTY)).toBe("クイック表（limb-bleeding）");
    expect(sourceLabel("flow:massive-bleeding", EMPTY)).toBe("フロー（massive-bleeding）");
    expect(sourceLabel("書式に合わない文字列", LOOKUPS)).toBe("書式に合わない文字列");
  });
});

describe("sourceKind", () => {
  it("名前を引くのに要る一覧の種類を返す", () => {
    expect(sourceKind("doc:pain.md#a")).toBe("doc");
    expect(sourceKind("quickref:limb-bleeding")).toBe("quickref");
    expect(sourceKind("flow:massive-bleeding")).toBe("flow");
    expect(sourceKind("https://example.com/")).toBe("other");
    expect(sourceKind("???")).toBe("other");
  });
});
