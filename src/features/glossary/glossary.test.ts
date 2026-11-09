// 原稿・クイック表・フローの表記が、ゲームの画面の表示名（content/glossary.yaml）と合っているかの検査。
// ACE Medical の版が上がって表示が英語から日本語に変わったとき、古い英語の表示名が残るのを見つけるため。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { bundledManuals, readBundledData } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { glossaryFileSchema, type GlossaryTerm } from "@/features/glossary/schema";
import { bundledQuickref } from "@/features/quickref/bundle";
import { bundledFlows } from "@/features/triage/bundle";
import { readRepoFile, REPO_ROOT } from "@/test/samples";

const glossary = glossaryFileSchema.parse(
  parse(readFileSync(resolve(REPO_ROOT, "content", "glossary.yaml"), "utf8")),
);

/**
 * 画面で一続きに読まれる文字列。where は失敗の表示に使う。
 * scope は一度に開いて読まれる単位（原稿 1 本・クイック表の 1 行・フローの 1 ノード）で、初出の判定に使う。
 */
interface TextUnit {
  where: string;
  scope: string;
  heading: boolean;
  text: string;
}

// YAML のうち、画面に文として出ないキー（識別子・リンク・分岐・表示条件・決まった値の一覧）。
// 文のキーを足したときに検査から漏れないよう、対象ではなく除外の方を並べる
const NON_TEXT_KEYS = new Set([
  "$schema",
  "id",
  "modTarget",
  "modChannel",
  "verifiedAt",
  "version",
  "order",
  "march",
  "start",
  "type",
  "next",
  "else",
  "cases",
  "links",
  "flowId",
  "mods",
  "withoutMods",
  "outcome",
  "category",
  "severity",
]);

function yamlStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(yamlStrings);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, v]) =>
      NON_TEXT_KEYS.has(key) ? [] : yamlStrings(v),
    );
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 設定名やファイル名は英語のままが正しいので、コードの中は見ない。
// 外部へのリンクの文字は出典の題（「MedlinePlus: Epinephrine Injection」など）で、ゲームの表示ではないので見ない
function visibleText(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  for (const el of Array.from(container.querySelectorAll('code, pre, a[href^="http"]'))) {
    el.remove();
  }
  return container.textContent;
}

async function manualUnits(): Promise<TextUnit[]> {
  const manuals = await bundledManuals();
  const converted = await Promise.all(
    manuals.map(async (manual) => ({
      manual,
      ...(await convertManual(manual, readRepoFile, readBundledData)),
    })),
  );
  return converted.flatMap(({ manual, doc }) => [
    { where: `${manual.fileName}（表題）`, scope: manual.fileName, heading: true, text: doc.title },
    ...doc.sections.flatMap((section) => {
      const where = `${manual.fileName}#${section.anchor}`;
      return [
        { where: `${where}（見出し）`, scope: manual.fileName, heading: true, text: section.title },
        { where, scope: manual.fileName, heading: false, text: visibleText(section.html) },
      ];
    }),
  ]);
}

async function quickrefUnits(): Promise<TextUnit[]> {
  const source = await bundledQuickref();
  const value: unknown = parse(source?.text ?? "");
  const rows = isRecord(value) && Array.isArray(value["rows"]) ? value["rows"] : [];
  return rows.flatMap((row: unknown) => {
    const id = isRecord(row) && typeof row["id"] === "string" ? row["id"] : "?";
    const where = `quickref.yaml の ${id}`;
    return yamlStrings(row).map((text) => ({ where, scope: where, heading: false, text }));
  });
}

async function flowUnits(): Promise<TextUnit[]> {
  const sources = await bundledFlows();
  return sources.flatMap((source) => {
    const value: unknown = parse(source.text);
    if (!isRecord(value)) {
      return [];
    }
    const { nodes, ...header } = value;
    const nodeUnits = isRecord(nodes)
      ? Object.entries(nodes).flatMap(([nodeId, node]) => {
          const where = `${source.fileName} の ${nodeId}`;
          return yamlStrings(node).map((text) => ({ where, scope: where, heading: false, text }));
        })
      : [];
    const headerUnits = yamlStrings(header).map((text) => ({
      where: source.fileName,
      scope: source.fileName,
      heading: false,
      text,
    }));
    return [...headerUnits, ...nodeUnits];
  });
}

const units = [...(await manualUnits()), ...(await quickrefUnits()), ...(await flowUnits())];

/**
 * 表示名に当たる正規表現。英数で始まる・終わる表示名は語の境界で区切る（「Bandage」が「Bandages」の中に当たらないように）。
 * %1・%2 は通知で数値が入る所なので、何かの文字列に当たればよい。
 */
function displayNamePattern(name: string): RegExp {
  const body = name
    .split(/%\d/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\S+");
  const start = /^[A-Za-z0-9]/.test(name) ? "(?<![A-Za-z0-9_])" : "";
  const end = /[A-Za-z0-9]$/.test(name) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(`${start}${body}${end}`, "gi");
}

/**
 * 英語の表示名を、名前として使っている所。日本語の後の括弧（「怪我が酷い（Too injured）」）は、
 * 英語で遊ぶ人が検索で見つけられるように添えた注記なので数えない。
 */
function englishUsedAsName(text: string, en: string): string[] {
  return Array.from(text.matchAll(displayNamePattern(en)))
    .filter((m) => !/[（(]$/.test(text.slice(0, m.index)))
    .map((m) => m[0]);
}

/**
 * 原稿での呼び方が最初に出た所の直後に、括弧で英語の表示名が添えてあるか。出てこなければ添える所が無いので通す。
 * 「あご先挙上（Lift chin、1 秒）」のように、英語の後に読点で補足が続く形も許す。
 */
function firstMentionAnnotated(text: string, manual: string, en: string): boolean {
  const index = text.indexOf(manual);
  if (index === -1) {
    return true;
  }
  const rest = text.slice(index + manual.length);
  return rest.startsWith(`（${en}）`) || rest.startsWith(`（${en}、`);
}

describe("英語の表示名の見つけ方", () => {
  it("語の境界と、通知の数値の位置を扱う", () => {
    expect(englishUsedAsName("Bandage を巻く", "Bandage")).toEqual(["Bandage"]);
    expect(englishUsedAsName("Bandages", "Bandage")).toEqual([]);
    expect(englishUsedAsName("ACE_Medical_Epinephrine", "Epinephrine")).toEqual([]);
    expect(englishUsedAsName("「perform cpr」", "Perform CPR")).toEqual(["perform cpr"]);
    expect(englishUsedAsName("You find a heart rate of 80", "You find a heart rate of %1")).toEqual(
      ["You find a heart rate of 80"],
    );
    expect(englishUsedAsName("patients", "Administered to unconscious patients.")).toEqual([]);
  });

  it("日本語の後の括弧の注記は数えず、名前として使った所だけを返す", () => {
    expect(englishUsedAsName("「怪我が酷い（Too injured）」", "Too injured")).toEqual([]);
    expect(englishUsedAsName("止血帯(Tourniquet)", "Tourniquet")).toEqual([]);
    expect(englishUsedAsName("Too injured（怪我が酷い）と Too injured", "Too injured")).toEqual([
      "Too injured",
      "Too injured",
    ]);
  });

  it("初出の併記は、最初に出た所だけを見る", () => {
    expect(
      firstMentionAnnotated("あご先挙上（Lift chin）。あご先挙上", "あご先挙上", "Lift chin"),
    ).toBe(true);
    expect(firstMentionAnnotated("あご先挙上（Lift chin、1 秒）", "あご先挙上", "Lift chin")).toBe(
      true,
    );
    expect(firstMentionAnnotated("回復体位にする", "あご先挙上", "Lift chin")).toBe(true);
    expect(
      firstMentionAnnotated("あご先挙上。あご先挙上（Lift chin）", "あご先挙上", "Lift chin"),
    ).toBe(false);
    expect(firstMentionAnnotated("あご先挙上（Breathing）", "あご先挙上", "Lift chin")).toBe(false);
    expect(firstMentionAnnotated("あご先挙上（Lift chinX）", "あご先挙上", "Lift chin")).toBe(
      false,
    );
  });
});

describe("原稿・クイック表・フローの表示名", () => {
  it("検査する文字列を、原稿・クイック表・フローのすべてから取り出せている", () => {
    const wheres = units.map((u) => u.where);
    expect(wheres.some((w) => w.startsWith("about-this-manual.md#"))).toBe(true);
    expect(wheres.some((w) => w.startsWith("quickref.yaml の "))).toBe(true);
    expect(wheres.some((w) => w.includes(".flow.yaml の "))).toBe(true);
    // 画面が日本語の用語が、本文に 1 つも見つからなければ取り出し方が壊れている
    expect(units.some((u) => u.text.includes("止血帯を使う"))).toBe(true);
  });

  const japaneseTerms = glossary.terms.filter(
    (term): term is GlossaryTerm & { ja: string } => term.ja !== undefined,
  );

  it.each(japaneseTerms.map((term) => [term.id, term] as const))(
    "%s: 日本語で表示される用語の英語の表示が残っていない",
    (_, term) => {
      const found = units.flatMap((u) =>
        englishUsedAsName(u.text, term.en).map((match) => `${u.where}: 「${match}」`),
      );
      expect(
        found,
        `ゲームを日本語にしていると「${term.ja}」と表示されます。日本語の表示名で書き、英語を添えるなら「${term.ja}（${term.en}）」の形にしてください（content/glossary.yaml の ${term.id}）`,
      ).toEqual([]);
    },
  );

  // 日本語で遊んでいても英語で出る操作は、ラジアルメニューから英語の名前で選ぶので、日本語の呼び方だけでは探せない。
  // 物品はカタカナから英語の見当がつき（チェストシール → Chest Seal）、診察の表示（緊張性気胸など）は
  // 病態の名前として本文で何度も使うので、どちらも初出の併記は求めない
  const englishActions = glossary.terms.filter(
    (term): term is GlossaryTerm & { manual: string } =>
      term.kind === "action" && term.manual !== undefined && term.manual !== term.en,
  );

  // 見出しは目次にも出る短い名前なので、併記は本文の初出に置く
  const scopes = new Map<string, string>();
  for (const unit of units.filter((u) => !u.heading)) {
    scopes.set(unit.scope, `${scopes.get(unit.scope) ?? ""}\n${unit.text}`);
  }

  it("英語で表示される操作が、検査の対象にある", () => {
    expect(englishActions.map((term) => term.id)).toContain("lift-chin");
  });

  it.each(englishActions.map((term) => [term.id, term] as const))(
    "%s: 英語で表示される操作は、原稿 1 本・クイック表の 1 行・フローの 1 ノードの初出で英語を添えている",
    (_, term) => {
      const missing = Array.from(scopes)
        .filter(([, text]) => !firstMentionAnnotated(text, term.manual, term.en))
        .map(([scope]) => scope);
      expect(
        missing,
        `ゲームでは日本語にしていても「${term.en}」と英語で表示されます。最初に出る所を「${term.manual}（${term.en}）」の形にしてください（content/glossary.yaml の ${term.id}）`,
      ).toEqual([]);
    },
  );
});
