import { describe, expect, it } from "vitest";

import {
  conditionRoots,
  sectionVisibility,
  type VisibilitySection,
} from "@/features/library/viewer/section-visibility";
import { activeMods } from "@/features/settings/mod-settings";
import type { ModTarget } from "@/lib/bindings/ModTarget";

function s(
  level: number,
  anchor: string,
  mods: ModTarget[] = [],
  withoutMods: ModTarget[] = [],
  hasBody = true,
): VisibilitySection {
  return { level, anchor, mods, withoutMods, hasBody };
}

// 変換で親の条件を子に合わせた後の形
const SECTIONS = [
  s(0, "intro"),
  s(1, "title"),
  s(2, "circ", ["circulation"]),
  s(3, "circ-detail", ["circulation"]),
  s(2, "breathing", ["breathing"]),
  s(3, "breathing-no-hz", ["breathing"], ["hitzones"]),
  s(2, "related"),
];
const usual = activeMods({ enabled: ["circulation", "breathing"] });
const hitzones = activeMods({ enabled: ["hitzones"] });

describe("sectionVisibility", () => {
  it("設定に合う節だけを出し、隠した数を数える", () => {
    const result = sectionVisibility(SECTIONS, hitzones, false, null);
    expect([...result.visible]).toEqual(["intro", "title", "related"]);
    expect(result.hiddenCount).toBe(4);
    expect(result.forcedRoot).toBeNull();
    expect(result.hasConditions).toBe(true);
  });

  it("すべての組み合わせを出すときは何も隠さない", () => {
    const result = sectionVisibility(SECTIONS, hitzones, true, "breathing-no-hz");
    expect(result.visible.size).toBe(SECTIONS.length);
    expect(result.forcedRoot).toBeNull();
  });

  it("隠れる節を直接開くと、隠れている一番上の親から配下までを出す", () => {
    const result = sectionVisibility(SECTIONS, hitzones, false, "breathing-no-hz");
    expect(result.forcedRoot).toBe("breathing");
    expect(result.visible.has("breathing")).toBe(true);
    expect(result.visible.has("breathing-no-hz")).toBe(true);
    expect(result.visible.has("circ")).toBe(false);
  });

  it("親が出ているときは開いた節と配下だけを出す", () => {
    const result = sectionVisibility(SECTIONS, usual, false, "breathing-no-hz");
    expect(result.forcedRoot).toBeNull();
    const withHitzones = activeMods({ enabled: ["breathing", "hitzones"] });
    const forced = sectionVisibility(SECTIONS, withHitzones, false, "breathing-no-hz");
    expect(forced.forcedRoot).toBe("breathing-no-hz");
    expect(forced.hiddenCount).toBe(2);
  });

  it("条件のない原稿は切り替えの表示を出さない", () => {
    const result = sectionVisibility([s(1, "a"), s(2, "b")], usual, false, "missing");
    expect(result.hasConditions).toBe(false);
    expect(result.hiddenCount).toBe(0);
  });
});

describe("ラベルにする節", () => {
  it("絞り込み中は、条件が新しく付いた節のうち設定に合うものをラベルにする", () => {
    const result = sectionVisibility(SECTIONS, usual, false, null);
    // circ-detail は親と同じ条件（親の下の話題の見出し）なので見出しのまま
    expect([...result.labeled]).toEqual(["circ", "breathing", "breathing-no-hz"]);
  });

  it("すべて出すときと、直接開いた隠れる節はラベルにしない", () => {
    expect(sectionVisibility(SECTIONS, usual, true, null).labeled.size).toBe(0);
    const forced = sectionVisibility(SECTIONS, hitzones, false, "circ");
    expect(forced.labeled.has("circ")).toBe(false);
  });

  it("親より条件が増えた節を、条件が新しく付く節とする", () => {
    expect([...conditionRoots(SECTIONS)]).toEqual(["circ", "breathing", "breathing-no-hz"]);
  });
});

describe("入れ物の見出し", () => {
  // 「## MOD による違い」の下に組み合わせの節だけがある形
  const WRAPPED = [
    s(1, "title"),
    s(2, "diff", [], [], false),
    s(3, "hz", ["hitzones"]),
    s(2, "related"),
  ];

  it("本文がなく配下がすべて隠れる見出しは一緒に隠す", () => {
    const result = sectionVisibility(WRAPPED, usual, false, null);
    expect([...result.visible]).toEqual(["title", "related"]);
    expect(result.hiddenCount).toBe(2);
  });

  it("配下が 1 つでも出るとき、すべて出すとき、配下を直接開いたときは残す", () => {
    expect(sectionVisibility(WRAPPED, hitzones, false, null).visible.has("diff")).toBe(true);
    expect(sectionVisibility(WRAPPED, usual, true, null).visible.has("diff")).toBe(true);
    expect(sectionVisibility(WRAPPED, usual, false, "hz").visible.has("diff")).toBe(true);
  });

  it("本文のある見出しは配下が隠れても残す", () => {
    const withBody = [s(2, "topic"), s(3, "hz", ["hitzones"])];
    expect([...sectionVisibility(withBody, usual, false, null).visible]).toEqual(["topic"]);
  });
});
