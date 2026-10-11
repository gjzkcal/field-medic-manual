// デスクトップ版の検索のテスト（src-tauri/src/db/search.rs）のうち、FTS5 に固有でないものを移したもの。
// フローは Web 版にないので、フローを含む並びの確認はフローを除いた並びで確かめる。
import { describe, expect, it } from "vitest";

import { MARK_START } from "@/features/search/snippet";
import type { NormalizedDoc } from "@/features/content/types";
import type { QuickrefHit } from "@/lib/bindings/QuickrefHit";
import type { SearchFilter } from "@/lib/bindings/SearchFilter";
import type { SearchHit } from "@/lib/bindings/SearchHit";
import type { SectionHit } from "@/lib/bindings/SectionHit";
import {
  bleeding,
  cpr,
  doc,
  EMPTY_QUICKREF,
  quickrefTable,
  section,
  tourniquet,
} from "@/test/web-fixtures";
import { searchStore } from "@/web/backend/search";
import { buildStore, type WebStore } from "@/web/backend/store";

const NOW = "2026-10-11T00:00:00.000Z";

function seeded(extra: NormalizedDoc[] = [], withQuickref = false): WebStore {
  return buildStore(
    [bleeding(), cpr(), tourniquet(), ...extra],
    withQuickref ? quickrefTable() : EMPTY_QUICKREF,
    NOW,
  );
}

function sections(hits: SearchHit[]): SectionHit[] {
  return hits.flatMap((h) => (h.kind === "section" ? [h] : []));
}

function hits(store: WebStore, query: string, filter: SearchFilter = {}): SectionHit[] {
  return sections(searchStore(store, query, { filter }));
}

function anchors(found: SectionHit[]): string[] {
  return found.map((h) => h.anchor);
}

function kinds(store: WebStore, query: string, filter: SearchFilter = {}): string[] {
  return searchStore(store, query, { filter }).map((h) =>
    h.kind === "section" ? `section:${h.anchor}` : `${h.kind}:${h.id}`,
  );
}

function firstQuickref(store: WebStore, query: string): QuickrefHit {
  const hit = searchStore(store, query).find((h) => h.kind === "quickref");
  if (hit?.kind !== "quickref") {
    throw new Error(`「${query}」でクイック表が当たらない`);
  }
  return hit;
}

describe("searchStore（節）", () => {
  it("3 文字の語で当たり、スニペットを強調する", () => {
    const result = hits(seeded(), "止血帯");
    expect(anchors(result)).toEqual(["use-tourniquet"]);
    expect(result[0]?.documentTitle).toBe("止血帯");
    expect(result[0]?.documentId).toBe("tourniquet");
    expect(result[0]?.synonymOnly).toBe(false);
    expect(result[0]?.snippet).toContain(`${MARK_START}止血帯`);
  });

  it("ASCII の語は大文字小文字を区別しない", () => {
    expect(anchors(hits(seeded(), "CPR"))).toEqual(["cpr-steps"]);
    expect(anchors(hits(seeded(), "cpr"))).toEqual(["cpr-steps"]);
  });

  it("2 文字の語はタイトルに当たった節を先にする", () => {
    const result = hits(seeded(), "出血");
    const found = anchors(result);
    expect(found).toContain("bleeding");
    expect(found).toContain("bleeding-signs");
    // 本文の「大量出血」にも当たる
    expect(found.at(-1)).toBe("use-tourniquet");
    expect(result[0]?.snippet).toContain(MARK_START);
  });

  it("1 文字の語でも探せる", () => {
    expect(hits(seeded(), "血")).toHaveLength(3);
    expect(hits(seeded(), "鯨")).toHaveLength(0);
  });

  it("記号は文字として探す", () => {
    for (const query of ['"', "*", "(", ")", "AND", "NEAR(", "-", "\\", "title:止血帯"]) {
      expect(() => searchStore(seeded(), query)).not.toThrow();
    }
    expect(hits(seeded(), "%")).toHaveLength(0);
    expect(hits(seeded(), "_")).toHaveLength(0);
    expect(hits(seeded(), "【要確認】")).toHaveLength(4);
  });

  it("空白（全角を含む）で区切った語は AND で結ぶ", () => {
    expect(anchors(hits(seeded(), "止血帯 四肢"))).toEqual(["use-tourniquet"]);
    expect(anchors(hits(seeded(), "止血帯　四肢"))).toEqual(["use-tourniquet"]);
    expect(hits(seeded(), "止血帯 CPR")).toHaveLength(0);
    expect(anchors(hits(seeded(), "心停止 行う"))).toEqual(["cpr-steps"]);
    expect(hits(seeded(), "心停止 四肢")).toHaveLength(0);
  });

  it("空の入力では何も返さない", () => {
    expect(searchStore(seeded(), "")).toEqual([]);
    expect(searchStore(seeded(), " 　 ")).toEqual([]);
  });

  it("件数の上限を守る", () => {
    expect(searchStore(seeded(), "要確認", { limit: 2 })).toHaveLength(2);
  });

  it("同義語で広げる", () => {
    for (const query of ["TQ", "tq", "ターニケット", "Tourniquet"]) {
      const result = hits(seeded(), query);
      expect(anchors(result), query).toEqual(["use-tourniquet"]);
      expect(result[0]?.synonymOnly, query).toBe(true);
    }
  });

  it("節に含まれていた同義語を、重複なく返す", () => {
    const result = hits(seeded(), "TQ");
    expect(result[0]?.matchedTerms).toContain("止血帯");
    expect(result[0]?.matchedTerms.some((t) => t.toLowerCase() === "tq")).toBe(false);

    const twice = hits(seeded(), "止血帯 止血帯");
    expect(twice[0]?.matchedTerms.filter((t) => t === "止血帯")).toHaveLength(1);
  });

  it("打った語そのものに当たった節を、同義語だけの節より上にする", () => {
    const literal = doc(
      "ターニケットの呼び方",
      "tq-name.md",
      null,
      null,
      [],
      [section(1, "呼び方", "tq-name", "【要確認】ターニケットと呼ぶこともある。")],
    );
    const result = hits(seeded([literal]), "ターニケット");
    expect(anchors(result)).toEqual(["tq-name", "use-tourniquet"]);
    expect(result[0]?.synonymOnly).toBe(false);
    expect(result[1]?.synonymOnly).toBe(true);
  });

  it("長い語には短い同義語（CA）を足さない", () => {
    const noise = doc(
      "無関係",
      "noise.md",
      null,
      null,
      [],
      [section(1, "Cascade", "noise", "cascade")],
    );
    expect(anchors(hits(seeded([noise]), "心停止"))).toEqual(["cpr-steps"]);
  });

  it("節のタグでも当たる", () => {
    expect(anchors(hits(seeded(), "圧迫止血"))).toEqual(["bleeding-signs"]);
  });

  it("MOD で絞り込む。空の配列は条件なし", () => {
    expect(anchors(hits(seeded(), "要確認", { modTargets: ["circulation"] }))).toEqual([
      "cpr-steps",
    ]);
    expect(hits(seeded(), "要確認", { modTargets: [] })).toHaveLength(4);
  });

  it("版で絞り込んでも、版を問わない原稿は残す", () => {
    const release = hits(seeded(), "要確認", { modChannel: "release" });
    expect(release).toHaveLength(3);
    expect(anchors(release)).not.toContain("cpr-steps");
    expect(hits(seeded(), "要確認", { modChannel: "dev" })).toHaveLength(4);
  });

  it("文書か節のタグで絞り込む", () => {
    expect(anchors(hits(seeded(), "要確認", { tags: ["止血帯"] }))).toEqual(["use-tourniquet"]);
    expect(anchors(hits(seeded(), "出血", { tags: ["#圧迫止血"] }))).toEqual(["bleeding-signs"]);
    expect(anchors(hits(seeded(), "要確認", { tags: ["出血", "圧迫止血"] }))).toEqual([
      "bleeding-signs",
    ]);
  });
});

describe("searchStore（クイック表）", () => {
  it("症状に当たった行を先頭にする", () => {
    const store = seeded([], true);
    expect(kinds(store, "気胸")).toEqual(["quickref:tension-ptx"]);
    const hit = firstQuickref(store, "気胸");
    expect(hit.title).toBe("緊張性気胸");
    expect(hit.category).toBe("気道・呼吸");
    expect(hit.severity).toBe(4);
    expect(hit.mods).toEqual(["breathing"]);
    const found = kinds(store, "出血");
    expect(found[0]).toBe("quickref:limb-bleeding");
    expect(found).toContain("section:bleeding");
  });

  it("本文だけに当たった行は節の後ろにする", () => {
    const store = seeded([], true);
    expect(kinds(store, "止血帯")).toEqual(["section:use-tourniquet", "quickref:limb-bleeding"]);
    const hit = firstQuickref(store, "止血帯");
    expect(hit.snippet).toContain(MARK_START);
    expect(hit.synonymOnly).toBe(false);
  });

  it("同義語で当たる", () => {
    const hit = firstQuickref(seeded([], true), "アドレナリン");
    expect(hit.id).toBe("unconscious-core");
    expect(hit.synonymOnly).toBe(true);
  });

  it("絞り込みに従う", () => {
    const store = seeded([], true);
    // Dev の表は出ない
    expect(kinds(store, "気胸", { modChannel: "release" })).toEqual([]);
    expect(kinds(store, "気胸", { modTargets: ["breathing"] })).toEqual(["quickref:tension-ptx"]);
    // 条件のない行は Core として扱う
    expect(kinds(store, "出血", { modTargets: ["breathing"] })).not.toContain(
      "quickref:limb-bleeding",
    );
    expect(kinds(store, "出血", { modTargets: ["core"] })).toContain("quickref:limb-bleeding");
    // タグで絞るとクイック表は出ない
    expect(kinds(store, "止血帯", { tags: ["止血帯"] })).toEqual(["section:use-tourniquet"]);
  });
});
