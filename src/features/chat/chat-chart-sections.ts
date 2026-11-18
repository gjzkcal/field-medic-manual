// AI が指定した原稿の節（chart_create の sections）から、グラフと表の線を取り出す。
// 値は節の HTML にあるものをそのまま使う（AI に数値を書き写させると、桁や行を取り違えた線が出るため）。
// chat-chart.ts と分けてあるのは、グラフの形の検査（zod）を、節の線を使うときだけ読み込むため。
import type { ChartLine, ChartPart } from "@/features/chat/chat-chart";
import {
  chartFromTable,
  mixedUnitColumns,
  readChartPayload,
  type ChartData,
} from "@/features/content/chart";
import { findDocByFile } from "@/features/content/link-target";
import { meetsModConditions } from "@/features/settings/mod-conditions";
import { parseFlowLink } from "@/features/triage/links";
import type { ActiveMods } from "@/features/triage/runner";
import type { ChartSection } from "@/lib/bindings/ChartSection";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import { docGet, docOutline } from "@/lib/tauri";

/** 線を探す範囲（AI が指した節と、その配下の節）。 */
export interface SectionScope {
  docId: string;
  docTitle: string;
  anchor: string;
  title: string;
  /** 節と配下の節（本文の順。先頭が AI の指した節） */
  sections: readonly { title: string; html: string }[];
}

/** 線や表のあった節。 */
interface Place {
  /** 節の見出し */
  section: string;
  /** AI が指した節そのものか（配下の節ではなく） */
  head: boolean;
}

interface NamedLine extends Place {
  /** 原稿での線の名前（表の列の見出し） */
  name: string;
  line: ChartLine;
}

function namedLines(
  data: ChartData,
  docTitle: string,
  place: Place,
  kind: "グラフ" | "表",
): NamedLine[] {
  return data.series.map((series) => ({
    section: place.section,
    head: place.head,
    name: series.label,
    line: {
      // どの原稿の線かが凡例で分かるようにする（別の原稿の同じ名前の線と重ねて比べるため）
      label: `${series.label}（${docTitle}）`,
      axis: `unit:${series.unit ?? ""}`,
      unit: series.unit,
      xLabel: data.xLabel,
      xUnit: data.xUnit,
      // 値を実際に取った節（指した節の配下のこともある）。AI が引用する節を取り違えないように返す
      origin: `原稿「${docTitle} > ${place.section}」の${kind}の値`,
      points: data.points.flatMap((p) => {
        const y = p.values[series.key];
        return y === undefined ? [] : [{ x: p.x, y }];
      }),
    },
  }));
}

/**
 * 凡例の名前が重なる線には、節の見出しも付ける（同じ原稿の別の節の、同じ名前の線を見分けるため）。
 * 重なるときだけにするのは、いつも付けると凡例が長くなって線が読みにくくなるため。
 * @param all 重なりを見る範囲（別々の指定で取った線も含める）
 */
function withDistinctLabels(
  lines: readonly NamedLine[],
  all: readonly NamedLine[],
  docTitle: string,
): NamedLine[] {
  return lines.map((named) =>
    all.some((other) => other !== named && other.line.label === named.line.label)
      ? {
          ...named,
          line: { ...named.line, label: `${named.name}（${docTitle} > ${named.section}）` },
        }
      : named,
  );
}

function tableHeaders(table: HTMLTableElement): string[] {
  return Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) =>
    cell.textContent.replaceAll(/\s+/gu, " ").trim(),
  );
}

interface ParsedSection extends Place {
  doc: Document;
}

interface SectionTable extends Place {
  table: HTMLTableElement;
}

/** グラフになっていない表。グラフ付きの表は、節のグラフの線として（x を空にして）使う */
function plainTables(sections: readonly ParsedSection[]): SectionTable[] {
  return sections.flatMap(({ section, head, doc }) =>
    Array.from(doc.querySelectorAll("table"))
      .filter((table) => !Object.hasOwn(table.dataset, "chart"))
      .map((table) => ({ section, head, table })),
  );
}

function quoted(names: readonly string[]): string {
  return [...new Set(names)].map((n) => `「${n}」`).join("、");
}

/** グラフになっていない表の列の一覧（AI が x と lines を書き直せるように返す）。 */
function plainTablesHint(tables: readonly SectionTable[]): string {
  if (tables.length === 0) {
    return "";
  }
  const columns = tables.map(({ table }) => `[${tableHeaders(table).join(", ")}]`).join("、");
  return `グラフになっていない表の列: ${columns}。表を使うときは、x に横軸の列、lines に縦の列の見出しを書いてください`;
}

/**
 * 候補が複数あるときに 1 つに決める。指した節そのものに 1 つだけあれば、それを使う
 * （配下の節にも同じ名前があるとき、親の節を指せば親のものを選べるようにするため）。決められなければ null
 */
function pickOne<T extends Place>(found: readonly T[]): T | null {
  const [first] = found;
  if (first === undefined || found.length === 1) {
    return first ?? null;
  }
  const inHead = found.filter((f) => f.head);
  return inHead.length === 1 ? (inHead[0] ?? null) : null;
}

/** 表の列から線を作る。 */
function fromTables(
  target: ChartSection,
  tables: readonly SectionTable[],
  docTitle: string,
): NamedLine[] | string {
  if (tables.length === 0) {
    return `${target.source} に、グラフになっていない表がありません。節のグラフの線を使うときは、x を空にしてください`;
  }
  const tried = tables.map((place) => ({
    ...place,
    chart: chartFromTable(place.table, {
      x: target.x,
      y: target.lines,
      y2: [],
      ref: [],
      title: null,
      data: null,
      unit: null,
    }),
  }));
  const usable = tried.filter(
    ({ chart }) => chart.warnings.length === 0 && chart.data.series.length > 0,
  );
  if (usable.length === 0) {
    const reasons = tried.map(
      ({ chart }, i) => `表 ${String(i + 1)}: ${chart.warnings.join("。")}`,
    );
    return `${target.source} の表から線を作れませんでした。${reasons.join(" ／ ")}`;
  }
  const picked = pickOne(usable);
  // 黙って最初の表を使うと、意図と違う表の値のグラフになる
  if (picked === null) {
    return `${target.source} には、列の合う表が ${String(usable.length)} つあります（節: ${quoted(usable.map((u) => u.section))}）。使う表のある節の source を指定してください`;
  }
  // 原稿のグラフは作者が目で確かめているが、ここで選んだ表は誰も確かめていない。
  // 単位の違う値（500 mL と 1 L）を同じ軸に並べると、大小が逆に見える
  const mixed = mixedUnitColumns(picked.table, [target.x, ...target.lines]);
  if (mixed.length > 0) {
    const detail = mixed.map((m) => `「${m.name}」（${m.units.join("、")}）`).join("、");
    return `${target.source} の表は、列の中で単位が混ざっているので線にできません: ${detail}`;
  }
  return namedLines(picked.chart.data, docTitle, picked, "表");
}

/** 節のグラフ（原稿で作者がグラフにしたもの）から線を選ぶ。 */
function fromCharts(
  target: ChartSection,
  sections: readonly ParsedSection[],
  docTitle: string,
): NamedLine[] | string {
  const tables = plainTables(sections);
  const all = sections.flatMap(({ section, head, doc }) =>
    Array.from(doc.querySelectorAll<HTMLElement>("table[data-chart], figure[data-chart]")).flatMap(
      (element) => {
        const payload = readChartPayload(element.dataset["chart"] ?? "");
        return payload === null
          ? []
          : namedLines(payload.data, docTitle, { section, head }, "グラフ");
      },
    ),
  );
  if (all.length === 0) {
    return [`${target.source} にグラフがありません。`, plainTablesHint(tables)].join("");
  }
  if (target.lines.length === 0) {
    return all;
  }
  // 凡例と要約では「名前（単位）」の形で見えるので、その形で書かれても受ける
  const matches = (wanted: string, { name, line }: NamedLine): boolean =>
    wanted === name || (line.unit !== null && wanted === `${name}（${line.unit}）`);
  const chosen: NamedLine[] = [];
  const missing: string[] = [];
  for (const wanted of target.lines) {
    const found = all.filter((l) => matches(wanted, l));
    const picked = pickOne(found);
    if (found.length === 0) {
      missing.push(wanted);
    } else if (picked === null) {
      // どれを指したのか決められない。全部を返すと、頼んでいない線が混ざる
      return `${target.source} には「${wanted}」という線が ${String(found.length)} 本あります（節: ${quoted(found.map((f) => f.section))}）。使う線のある節の source を指定してください`;
    } else if (!chosen.includes(picked)) {
      chosen.push(picked);
    }
  }
  if (missing.length > 0) {
    return [
      `${target.source} のグラフに${quoted(missing)}という線はありません。この節のグラフの線: ${[...new Set(all.map((l) => l.name))].join("、")}。`,
      plainTablesHint(tables),
    ].join("");
  }
  return chosen;
}

function chosenLines(target: ChartSection, scope: SectionScope): NamedLine[] | string {
  const sections = scope.sections.map(({ title, html }, index) => ({
    section: title,
    head: index === 0,
    doc: new DOMParser().parseFromString(html, "text/html"),
  }));
  return target.x === ""
    ? fromCharts(target, sections, scope.docTitle)
    : fromTables(target, plainTables(sections), scope.docTitle);
}

function toPart(target: ChartSection, scope: SectionScope, found: readonly NamedLine[]): ChartPart {
  const title = `${scope.docTitle} > ${scope.title}`;
  return {
    lines: found.map((l) => l.line),
    condition: `原稿「${title}」の${target.x === "" ? "グラフ" : "表"}の線: ${found.map((l) => l.name).join("、")}`,
    source: { title, docId: scope.docId, anchor: scope.anchor },
  };
}

/** 節の HTML から線を作る。作れないときは、AI が条件を直せるように理由を返す。 */
export function sectionPart(target: ChartSection, scope: SectionScope): ChartPart | string {
  const found = chosenLines(target, scope);
  return typeof found === "string"
    ? found
    : toPart(target, scope, withDistinctLabels(found, found, scope.docTitle));
}

/**
 * 節と、その配下の節（見出しのレベルが深いもの）。グラフは小見出しの下にあることが多い。
 * 配下の節は、利用者の MOD に合うものだけにする（「Circulation なしの場合」の線を、Circulation のある利用者に出さないため）。
 * AI が名指しした節そのものは、条件が合わなくても読む（合わない内容を、聞かれて示すことがあるため）
 */
function scopeOf(detail: DocDetail, anchor: string, active: ActiveMods): SectionScope | null {
  const index = detail.sections.findIndex((s) => s.anchor === anchor);
  const head = detail.sections[index];
  if (head === undefined) {
    return null;
  }
  const rest = detail.sections.slice(index + 1);
  const end = rest.findIndex((s) => s.level <= head.level);
  const below = (end === -1 ? rest : rest.slice(0, end)).filter((s) =>
    meetsModConditions(s, active),
  );
  return {
    docId: detail.id,
    docTitle: detail.title,
    anchor,
    title: head.title,
    sections: [head, ...below].map((s) => ({ title: s.title, html: s.html })),
  };
}

/** 指定された節を読んで、線にする。1 つでも作れなければ、その理由を返す。 */
export async function loadSectionParts(
  targets: readonly ChartSection[],
  active: ActiveMods,
): Promise<ChartPart[] | string> {
  const outline = await docOutline();
  const details = new Map<string, DocDetail>();
  const found: { target: ChartSection; scope: SectionScope; lines: NamedLine[] }[] = [];
  for (const target of targets) {
    const link = parseFlowLink(target.source);
    if (link?.kind !== "doc" || link.anchor === null) {
      return `${target.source} は節を指していません。見出しのある節の source（doc:<ファイル名>#<アンカー>）を使ってください`;
    }
    const doc = findDocByFile(outline, link.fileName);
    if (doc === undefined) {
      return `${target.source} の原稿が見つかりません`;
    }
    const detail = details.get(doc.id) ?? (await docGet(doc.id));
    details.set(doc.id, detail);
    const scope = scopeOf(detail, link.anchor, active);
    if (scope === null) {
      return `${target.source} の節が見つかりません`;
    }
    const lines = chosenLines(target, scope);
    if (typeof lines === "string") {
      return lines;
    }
    found.push({ target, scope, lines });
  }
  // 名前の重なりは、指定をまたいで見る（同じ原稿の別の節を 2 つ指したときも見分けられるように）
  const all = found.flatMap((f) => f.lines);
  return found.map(({ target, scope, lines }) =>
    toPart(target, scope, withDistinctLabels(lines, all, scope.docTitle)),
  );
}
