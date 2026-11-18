// AI が指定した原稿の節（chart_create の sections）から、グラフと表の線を取り出す。
// 値は節の HTML にあるものをそのまま使う（AI に数値を書き写させると、桁や行を取り違えた線が出るため）。
// chat-chart.ts と分けてあるのは、グラフの形の検査（zod）を、節の線を使うときだけ読み込むため。
import type { ChartLine, ChartPart } from "@/features/chat/chat-chart";
import { chartFromTable, readChartPayload, type ChartData } from "@/features/content/chart";
import { findDocByFile } from "@/features/content/link-target";
import { parseFlowLink } from "@/features/triage/links";
import type { ChartSection } from "@/lib/bindings/ChartSection";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import { docGet, docOutline } from "@/lib/tauri";

/** 線を探す範囲（AI が指した節と、その配下の節）。 */
export interface SectionScope {
  docId: string;
  docTitle: string;
  anchor: string;
  title: string;
  /** 節と配下の節の HTML（本文の順） */
  htmls: readonly string[];
}

interface NamedLine {
  /** 原稿での線の名前（表の列の見出し） */
  name: string;
  line: ChartLine;
}

function namedLines(data: ChartData, docTitle: string): NamedLine[] {
  return data.series.map((series) => ({
    name: series.label,
    line: {
      // どの原稿の線かが凡例で分かるようにする（別の原稿の同じ名前の線と重ねて比べるため）
      label: `${series.label}（${docTitle}）`,
      axis: `unit:${series.unit ?? ""}`,
      unit: series.unit,
      xLabel: data.xLabel,
      xUnit: data.xUnit,
      points: data.points.flatMap((p) => {
        const y = p.values[series.key];
        return y === undefined ? [] : [{ x: p.x, y }];
      }),
    },
  }));
}

function tableHeaders(table: HTMLTableElement): string[] {
  return Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) =>
    cell.textContent.replaceAll(/\s+/gu, " ").trim(),
  );
}

/** グラフになっていない表の列の一覧（AI が x と lines を書き直せるように返す）。 */
function plainTablesHint(tables: readonly HTMLTableElement[]): string {
  const plain = tables.filter((t) => !Object.hasOwn(t.dataset, "chart"));
  if (plain.length === 0) {
    return "";
  }
  const columns = plain.map((t) => `[${tableHeaders(t).join(", ")}]`).join("、");
  return `グラフになっていない表の列: ${columns}。表を使うときは、x に横軸の列、lines に縦の列の見出しを書いてください`;
}

/** 表の列から線を作る。 */
function fromTables(
  target: ChartSection,
  tables: readonly HTMLTableElement[],
  docTitle: string,
): NamedLine[] | string {
  if (tables.length === 0) {
    return `${target.source} に表がありません`;
  }
  const tried = tables.map((table) =>
    chartFromTable(table, {
      x: target.x,
      y: target.lines,
      y2: [],
      ref: [],
      title: null,
      data: null,
      unit: null,
    }),
  );
  const usable = tried.find((t) => t.warnings.length === 0 && t.data.series.length > 0);
  if (usable === undefined) {
    const reasons = tried.map((t, i) => `表 ${String(i + 1)}: ${t.warnings.join("。")}`);
    return `${target.source} の表から線を作れませんでした。${reasons.join(" ／ ")}`;
  }
  return namedLines(usable.data, docTitle);
}

/** 節のグラフ（原稿で作者がグラフにしたもの）から線を選ぶ。 */
function fromCharts(
  target: ChartSection,
  docs: readonly Document[],
  docTitle: string,
): NamedLine[] | string {
  const tables = docs.flatMap((d) => Array.from(d.querySelectorAll("table")));
  const all = docs
    .flatMap((d) =>
      Array.from(d.querySelectorAll<HTMLElement>("table[data-chart], figure[data-chart]")),
    )
    .flatMap((element) => {
      const payload = readChartPayload(element.dataset["chart"] ?? "");
      return payload === null ? [] : namedLines(payload.data, docTitle);
    });
  if (all.length === 0) {
    return [`${target.source} にグラフがありません。`, plainTablesHint(tables)].join("");
  }
  if (target.lines.length === 0) {
    return all;
  }
  // 凡例と要約では「名前（単位）」の形で見えるので、その形で書かれても受ける
  const matches = (wanted: string, { name, line }: NamedLine): boolean =>
    wanted === name || (line.unit !== null && wanted === `${name}（${line.unit}）`);
  const missing = target.lines.filter((wanted) => !all.some((l) => matches(wanted, l)));
  if (missing.length > 0) {
    const names = [...new Set(all.map((l) => l.name))].join("、");
    return [
      `${target.source} のグラフに「${missing.join("」「")}」という線はありません。この節のグラフの線: ${names}。`,
      plainTablesHint(tables),
    ].join("");
  }
  return all.filter((l) => target.lines.some((wanted) => matches(wanted, l)));
}

/** 節の HTML から線を作る。作れないときは、AI が条件を直せるように理由を返す。 */
export function sectionPart(target: ChartSection, scope: SectionScope): ChartPart | string {
  const docs = scope.htmls.map((html) => new DOMParser().parseFromString(html, "text/html"));
  const found =
    target.x === ""
      ? fromCharts(target, docs, scope.docTitle)
      : fromTables(
          target,
          docs.flatMap((d) => Array.from(d.querySelectorAll("table"))),
          scope.docTitle,
        );
  if (typeof found === "string") {
    return found;
  }
  const title = `${scope.docTitle} > ${scope.title}`;
  return {
    lines: found.map((l) => l.line),
    condition: `原稿「${title}」の${target.x === "" ? "グラフ" : "表"}の線: ${found.map((l) => l.name).join("、")}`,
    source: { title, docId: scope.docId, anchor: scope.anchor },
  };
}

/** 節と、その配下の節（見出しのレベルが深いもの）。グラフは小見出しの下にあることが多い。 */
function scopeOf(detail: DocDetail, anchor: string): SectionScope | null {
  const index = detail.sections.findIndex((s) => s.anchor === anchor);
  const head = detail.sections[index];
  if (head === undefined) {
    return null;
  }
  const rest = detail.sections.slice(index + 1);
  const end = rest.findIndex((s) => s.level <= head.level);
  const below = end === -1 ? rest : rest.slice(0, end);
  return {
    docId: detail.id,
    docTitle: detail.title,
    anchor,
    title: head.title,
    htmls: [head, ...below].map((s) => s.html),
  };
}

/** 指定された節を読んで、線にする。1 つでも作れなければ、その理由を返す。 */
export async function loadSectionParts(
  targets: readonly ChartSection[],
): Promise<ChartPart[] | string> {
  const outline = await docOutline();
  const details = new Map<string, DocDetail>();
  const parts: ChartPart[] = [];
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
    const scope = scopeOf(detail, link.anchor);
    if (scope === null) {
      return `${target.source} の節が見つかりません`;
    }
    const part = sectionPart(target, scope);
    if (typeof part === "string") {
      return part;
    }
    parts.push(part);
  }
  return parts;
}
