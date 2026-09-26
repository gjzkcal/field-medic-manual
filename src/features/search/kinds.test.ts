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
