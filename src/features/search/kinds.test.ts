import { describe, expect, it } from "vitest";

import { hitKey, searchKind } from "@/features/search/kinds";
import type { SearchHit } from "@/lib/bindings/SearchHit";

const HIT: SearchHit = {
  kind: "section",
  id: 7,
  title: "止血帯を使う",
  snippet: "",
  score: 1,
  documentId: "d1",
  documentTitle: "止血",
  anchor: "止血帯を使う",
  synonymOnly: true,
  matchedTerms: ["止血帯"],
};

describe("searchKind（section）", () => {
  it("開く先は文書のアンカーで、一致した語をハイライト用に載せる", () => {
    expect(searchKind(HIT.kind).href(HIT)).toBe(
      `/doc/d1?hl=${encodeURIComponent("止血帯")}#${encodeURIComponent("止血帯を使う")}`,
    );
  });

  it("どの文書かと、同義語でのヒットを示す", () => {
    const kind = searchKind(HIT.kind);
    expect(kind.context(HIT)).toBe("止血");
    expect(kind.badge(HIT)).toBe("同義語");
    expect(kind.badge({ ...HIT, synonymOnly: false })).toBeNull();
  });

  it("項目の値は種類と id から作る", () => {
    expect(hitKey(HIT)).toBe("section:7");
  });
});

describe("searchKind（quickref）", () => {
  const QUICKREF_HIT: SearchHit = {
    kind: "quickref",
    id: "tension-ptx",
    title: "緊張性気胸",
    category: "気道・呼吸",
    severity: 4,
    mods: ["breathing"],
    withoutMods: [],
    snippet: "",
    score: 3,
    synonymOnly: false,
  };

  it("開く先はその行を指したクイック表", () => {
    expect(searchKind(QUICKREF_HIT.kind).href(QUICKREF_HIT)).toBe("/quickref?row=tension-ptx");
    expect(searchKind(QUICKREF_HIT.kind).favoriteTarget(QUICKREF_HIT)).toEqual({
      kind: "quickref",
      rowId: "tension-ptx",
    });
    expect(hitKey(QUICKREF_HIT)).toBe("quickref:tension-ptx");
  });

  it("重症度・カテゴリと、表示条件の MOD を示す（検索は MOD の設定で絞らないため）", () => {
    const kind = searchKind(QUICKREF_HIT.kind);
    expect(kind.context(QUICKREF_HIT)).toBe("致命的 · 気道・呼吸");
    expect(kind.badge(QUICKREF_HIT)).toBe("Breathing あり");
    expect(kind.badge({ ...QUICKREF_HIT, mods: [], synonymOnly: true })).toBe("同義語");
    expect(kind.badge({ ...QUICKREF_HIT, mods: [] })).toBeNull();
  });
});

describe("searchKind（flow）", () => {
  const FLOW_HIT: SearchHit = {
    kind: "flow",
    id: "casualty-first-contact",
    title: "負傷者を見つけたら",
    snippet: "",
    score: 3,
    synonymOnly: false,
  };

  it("開く先はフローの実行画面", () => {
    expect(searchKind(FLOW_HIT.kind).href(FLOW_HIT)).toBe("/triage/casualty-first-contact");
    expect(searchKind(FLOW_HIT.kind).context(FLOW_HIT)).toBe("トリアージ");
    expect(hitKey(FLOW_HIT)).toBe("flow:casualty-first-contact");
  });
});
