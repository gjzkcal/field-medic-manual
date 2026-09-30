// 原稿の表のグラフ。表の直前の `<!-- chart: x=経過; y=SpO2 -->` を読み、表の中身から折れ線の系列を作る。
// 数値は表にだけ書く（グラフ用に二重に持つと、表を直したときにグラフが古いまま残るため）。
// 変換（印の検査と data-chart の付与）とビューア（描画）の両方がここを使う。
import { z } from "zod";

export const chartSpecSchema = z.strictObject({
  x: z.string().min(1),
  y: z.array(z.string().min(1)).min(1),
  y2: z.array(z.string().min(1)),
  ref: z.array(z.number()),
  title: z.string().nullable(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export type ChartAxis = "left" | "right";

export interface ChartSeries {
  /** 点の値を引くキー（列名は記号を含むので、描画ライブラリのキーには使わない） */
  key: string;
  label: string;
  axis: ChartAxis;
}

export interface ChartPoint {
  x: number;
  values: Record<string, number>;
}

export interface ChartData {
  xLabel: string;
  series: ChartSeries[];
  /** x の小さい順 */
  points: ChartPoint[];
}

const CHART_COMMENT = /^\s*chart\s*[:：](.*)$/is;
const SPEC_KEYS = new Set(["x", "y", "y2", "ref", "title"]);

/** コメントの中身がグラフの印なら、印の本文（`chart:` の後ろ）を返す。 */
export function chartMarkerBody(comment: string): string | null {
  return CHART_COMMENT.exec(comment)?.[1] ?? null;
}

/** 印の本文を読む。書き間違いは黙って捨てず、原稿の検査で気づけるようにエラーにする。 */
export function parseChartSpec(body: string): { spec: ChartSpec } | { error: string } {
  const entries = new Map<string, string>();
  for (const part of body.split(/[;；]/)) {
    if (part.trim() === "") {
      continue;
    }
    const match = /^\s*([^=＝]+?)\s*[=＝](.*)$/s.exec(part);
    const key = match?.[1]?.toLowerCase();
    const value = match?.[2]?.trim() ?? "";
    if (key === undefined) {
      return { error: `「${part.trim()}」は「キー=値」の形ではありません` };
    }
    if (!SPEC_KEYS.has(key)) {
      return { error: `知らないキー「${key}」です（x / y / y2 / ref / title）` };
    }
    if (entries.has(key)) {
      return { error: `キー「${key}」が 2 回あります` };
    }
    if (value === "") {
      return { error: `キー「${key}」の値が空です` };
    }
    entries.set(key, value);
  }

  const x = entries.get("x");
  const y = splitList(entries.get("y"));
  const y2 = splitList(entries.get("y2"));
  if (x === undefined || y.length === 0) {
    return { error: "x（横軸の列）と y（縦軸の列）は必須です" };
  }
  const columns = [x, ...y, ...y2];
  const duplicate = columns.find((c, i) => columns.indexOf(c) !== i);
  if (duplicate !== undefined) {
    return { error: `列「${duplicate}」を 2 回指定しています` };
  }
  const ref: number[] = [];
  for (const item of splitList(entries.get("ref"))) {
    const value = parseNumber(item);
    if (value === null) {
      return { error: `ref の「${item}」は数値ではありません` };
    }
    ref.push(value);
  }
  return { spec: { x, y, y2, ref, title: entries.get("title") ?? null } };
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

// 原稿では負の数に U+2212（−）も使う
const NUMBER = String.raw`[-−]?\d+(?:\.\d+)?`;
// 単位は 1 語だけ許す。`85% 未満` のように文が続くセルは、しきい値の説明なので点にしない
const CELL = new RegExp(
  String.raw`^(${NUMBER})(?:\s*\/\s*(${NUMBER}))?(?:\s*(秒|分|[A-Za-z%°/]+))?$`,
);
// 末尾の補足（`914 s（約 15 分 14 秒）`）は値に含めない
const NOTE = /\s*[（(][^（）()]*[）)]\s*$/;

function parseNumber(text: string): number | null {
  const value = Number(text.trim().replace("−", "-"));
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
}

/**
 * 表のセルを数値にする。`119/79` のような上と下の組は 2 つの値を返す。点にならないセルは null。
 * 時間の軸をそろえるため、`分` は秒に直す。
 */
export function parseChartCell(text: string): number[] | null {
  const match = CELL.exec(text.replace(NOTE, "").trim());
  if (match === null) {
    return null;
  }
  const scale = match[3] === "分" ? 60 : 1;
  const values = [match[1], match[2]]
    .filter((v) => v !== undefined)
    .map((v) => parseNumber(v));
  return values.every((v) => v !== null) ? values.map((v) => v * scale) : null;
}

/** 表の中身と印から系列を作る。印の列が表にないときや、点が 2 つ未満の線は警告にする。 */
export function chartFromTable(
  table: HTMLTableElement,
  spec: ChartSpec,
): { data: ChartData; warnings: string[] } {
  const warnings: string[] = [];
  const headers = Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) =>
    cell.textContent.replace(/\s+/g, " ").trim(),
  );
  const rows = Array.from(table.tBodies).flatMap((body) =>
    Array.from(body.rows, (row) => Array.from(row.cells, (cell) => cell.textContent)),
  );
  const columnIndex = (name: string): number | null => {
    const index = headers.indexOf(name);
    if (index === -1) {
      warnings.push(`列「${name}」が表にありません（表の列: ${headers.join(", ")}）`);
      return null;
    }
    return index;
  };

  const xIndex = columnIndex(spec.x);
  // 横軸が点にならない行（`—` や説明の文）は、ほかの列の値も置き場がないので点にしない
  const xs = rows.map((cells) => {
    const value = xIndex === null ? null : parseChartCell(cells[xIndex] ?? "");
    return value?.length === 1 ? (value[0] ?? null) : null;
  });
  const values: Record<string, number>[] = rows.map(() => ({}));

  const series: ChartSeries[] = [];
  const onAxis =
    (axis: ChartAxis) =>
    (name: string): { name: string; axis: ChartAxis } => ({ name, axis });
  for (const { name, axis } of [...spec.y.map(onAxis("left")), ...spec.y2.map(onAxis("right"))]) {
    const index = columnIndex(name);
    // 横軸の列が無いときは、点が無いことを線ごとに繰り返し警告しない
    if (index === null || xIndex === null) {
      continue;
    }
    const cells = rows.map((cells) => parseChartCell(cells[index] ?? ""));
    // 1 つでも「上/下」の組があれば、列を上と下の 2 本の線に分ける
    const size = cells.some((v) => v?.length === 2) ? 2 : 1;
    const parts =
      size === 2
        ? [
            { label: `${name}（上）`, pick: 0 },
            { label: `${name}（下）`, pick: 1 },
          ]
        : [{ label: name, pick: 0 }];
    for (const { label, pick } of parts) {
      const key = `s${String(series.length)}`;
      let count = 0;
      cells.forEach((cell, row) => {
        const value = cell?.length === size ? cell[pick] : undefined;
        const target = values[row];
        if (value !== undefined && target !== undefined && typeof xs[row] === "number") {
          target[key] = value;
          count += 1;
        }
      });
      if (count < 2) {
        warnings.push(`「${label}」の点が 2 つ未満です（数値のセルが足りません）`);
      }
      series.push({ key, label, axis });
    }
  }

  const points = xs
    .flatMap((x, row) => (x === null ? [] : [{ x, values: values[row] ?? {} }]))
    .sort((a, b) => a.x - b.x);

  return {
    data: {
      xLabel: spec.x,
      series,
      points,
    },
    warnings,
  };
}

/** 表に付けた `data-chart` を読む。DB の中身を書き換えられた場合に備え、形を確かめてから使う。 */
export function readChartSpec(json: string): ChartSpec | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const result = chartSpecSchema.safeParse(value);
  return result.success ? result.data : null;
}
