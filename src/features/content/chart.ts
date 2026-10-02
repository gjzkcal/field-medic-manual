// 原稿の表のグラフ。表の直前の `<!-- chart: x=経過; y=SpO2 -->` を読み、表の中身から折れ線の系列を作る。
// 表より細かい点で描くときは、印の `data=` で原稿の横の CSV を指す。表は md に手で書いたまま残すので、
// 表と CSV が食い違わないよう、表の各行の値を CSV の同じ時刻の値と突き合わせる。
// 表を作らずに推移の形だけを見せたいとき（薬の濃度など）は、表のない場所に印を置き、CSV の点だけで描く。
// 変換（印の検査と data-chart の付与）とビューア（data-chart の検証）の両方がここを使う。
import { z } from "zod";

export const chartSpecSchema = z.strictObject({
  x: z.string().min(1),
  y: z.array(z.string().min(1)).min(1),
  y2: z.array(z.string().min(1)),
  ref: z.array(z.number()),
  title: z.string().nullable(),
  data: z.string().nullable(),
  // 表なしのグラフの y の線の単位。表があるときは表のセルから取る
  unit: z.string().nullable(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

/**
 * 線を描くグラフ。`y2`（単位の違う列）は、横軸をそろえた 2 つ目のグラフに描く。
 * 1 つのグラフに縦軸を 2 本持たせると、目盛りの合わせ方で線の交わりが動き、データにない関係が見えてしまうため。
 */
const chartPanelSchema = z.enum(["y", "y2"]);
export type ChartPanel = z.infer<typeof chartPanelSchema>;

const chartSeriesSchema = z.strictObject({
  // 点の値を引くキー（列名は記号を含むので、描画ライブラリのキーには使わない）
  key: z.string().min(1),
  label: z.string(),
  panel: chartPanelSchema,
  // 列のセルに共通の単位（`%` など）。単位が無いか、セルごとに違えば null
  unit: z.string().nullable(),
});
export type ChartSeries = z.infer<typeof chartSeriesSchema>;

const chartPointSchema = z.strictObject({
  x: z.number(),
  values: z.record(z.string(), z.number()),
});
export type ChartPoint = z.infer<typeof chartPointSchema>;

const chartDataSchema = z.strictObject({
  xLabel: z.string(),
  // 横軸のセルに共通の単位。時間（`s` / `秒` / `分`）は秒に直して `s` にする
  xUnit: z.string().nullable(),
  series: z.array(chartSeriesSchema),
  // x の小さい順
  points: z.array(chartPointSchema),
});
export type ChartData = z.infer<typeof chartDataSchema>;

/** 表の `data-chart` に入れるもの。ビューアは CSV を読めないので、点まで埋め込む */
const chartPayloadSchema = z.strictObject({ spec: chartSpecSchema, data: chartDataSchema });
export type ChartPayload = z.infer<typeof chartPayloadSchema>;

const CHART_COMMENT = /^\s*chart\s*[:：](.*)$/is;
const SPEC_KEYS = new Set(["x", "y", "y2", "ref", "title", "data", "unit"]);

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
      return { error: `知らないキー「${key}」です（x / y / y2 / ref / title / data / unit）` };
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
  return {
    spec: {
      x,
      y,
      y2,
      ref,
      title: entries.get("title") ?? null,
      data: entries.get("data") ?? null,
      unit: entries.get("unit") ?? null,
    },
  };
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

const TIME_UNITS = new Set(["s", "秒", "分"]);

interface ChartCell {
  values: number[];
  /** 値ごとの小数の桁数（CSV と突き合わせるときの丸めの幅に使う） */
  decimals: number[];
  unit: string | null;
}

/**
 * 表のセルを数値にする。`119/79` のような上と下の組は 2 つの値を返す。点にならないセルは null。
 * 時間の軸をそろえるため、`分` は秒に直す。
 */
export function parseChartCell(text: string): number[] | null {
  return readCell(text)?.values ?? null;
}

function readCell(text: string): ChartCell | null {
  const match = CELL.exec(text.replace(NOTE, "").trim());
  if (match === null) {
    return null;
  }
  const rawUnit = match[3];
  const scale = rawUnit === "分" ? 60 : 1;
  const unit = rawUnit === undefined ? null : TIME_UNITS.has(rawUnit) ? "s" : rawUnit;
  const texts = [match[1], match[2]].filter((v) => v !== undefined);
  const values = texts.map((v) => parseNumber(v));
  const decimals = texts.map((v) => v.split(".")[1]?.length ?? 0);
  return values.every((v) => v !== null)
    ? { values: values.map((v) => v * scale), decimals, unit }
    : null;
}

/** 点になったセルの単位がすべて同じならその単位。単位の無いセルは数えない（`0` だけ単位を省く書き方があるため） */
function commonUnit(cells: (ChartCell | null)[]): string | null {
  const units = new Set(cells.flatMap((c) => (typeof c?.unit === "string" ? [c.unit] : [])));
  const [only] = units;
  return units.size === 1 && only !== undefined ? only : null;
}

export interface TableChart {
  data: ChartData;
  /** data.points と同じ並びで、値ごとに許す丸めの差（表の桁の半分） */
  tolerances: Record<string, number>[];
  warnings: string[];
}

/** 表の中身と印から系列を作る。印の列が表にないときや、点が 2 つ未満の線は警告にする。 */
export function chartFromTable(table: HTMLTableElement, spec: ChartSpec): TableChart {
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

  if (spec.unit !== null) {
    warnings.push("表のグラフでは unit を書けません（単位は表のセルから取ります）");
  }
  const xIndex = columnIndex(spec.x);
  // 横軸が点にならない行（`—` や説明の文）は、ほかの列の値も置き場がないので点にしない
  const xCells = rows.map((cells) => {
    const cell = xIndex === null ? null : readCell(cells[xIndex] ?? "");
    return cell?.values.length === 1 ? cell : null;
  });
  const xs = xCells.map((cell) => cell?.values[0] ?? null);
  const values: Record<string, number>[] = rows.map(() => ({}));
  const tolerances: Record<string, number>[] = rows.map(() => ({}));

  const series: ChartSeries[] = [];
  const onPanel =
    (panel: ChartPanel) =>
    (name: string): { name: string; panel: ChartPanel } => ({ name, panel });
  for (const { name, panel } of [...spec.y.map(onPanel("y")), ...spec.y2.map(onPanel("y2"))]) {
    const index = columnIndex(name);
    // 横軸の列が無いときは、点が無いことを線ごとに繰り返し警告しない
    if (index === null || xIndex === null) {
      continue;
    }
    const cells = rows.map((cells) => readCell(cells[index] ?? ""));
    const unit = commonUnit(cells);
    // 1 つでも「上/下」の組があれば、列を上と下の 2 本の線に分ける
    const size = cells.some((c) => c?.values.length === 2) ? 2 : 1;
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
        const value = cell?.values.length === size ? cell.values[pick] : undefined;
        const target = values[row];
        const tolerance = tolerances[row];
        if (
          value !== undefined &&
          target !== undefined &&
          tolerance !== undefined &&
          typeof xs[row] === "number"
        ) {
          target[key] = value;
          tolerance[key] = 0.5 * 10 ** -(cell?.decimals[pick] ?? 0);
          count += 1;
        }
      });
      if (count < 2) {
        warnings.push(`「${label}」の点が 2 つ未満です（数値のセルが足りません）`);
      }
      series.push({ key, label, panel, unit });
    }
  }

  const rowsWithX = xs
    .flatMap((x, row) =>
      x === null ? [] : [{ x, values: values[row] ?? {}, tolerance: tolerances[row] ?? {} }],
    )
    .sort((a, b) => a.x - b.x);

  return {
    data: {
      xLabel: spec.x,
      xUnit: commonUnit(xCells),
      series,
      points: rowsWithX.map(({ x, values }) => ({ x, values })),
    },
    tolerances: rowsWithX.map((r) => r.tolerance),
    warnings,
  };
}

/**
 * 表なしのグラフの骨組み（点は空）。点は chartFromCsv で CSV から入れる。
 * 突き合わせる表の行が無いので、CSV の点をそのまま描く。横軸は CSV の約束どおり秒。
 */
export function chartWithoutTable(spec: ChartSpec): TableChart {
  const warnings: string[] = [];
  if (spec.data === null) {
    warnings.push("印のすぐ後に表がありません（表なしで描くときは data= で CSV を指してください）");
  }
  // 2 つ目のグラフの単位を書く場所がないので、表なしでは 1 つのグラフだけにする
  if (spec.y2.length > 0) {
    warnings.push("表なしのグラフでは y2 を使えません");
  }
  return {
    data: {
      xLabel: spec.x,
      xUnit: "s",
      series: spec.y.map((label, i) => ({
        key: `s${String(i)}`,
        label,
        panel: "y",
        unit: spec.unit,
      })),
      points: [],
    },
    tolerances: [],
    warnings,
  };
}

/**
 * CSV から表と同じ線の細かい点を作り、表の各行の値と突き合わせる。
 * CSV の 1 列目が横軸（秒）。ほかの列の名前は表の線の名前（`a/b` の列は `列名（上）` / `列名（下）`）。
 * 値は数値だけで、単位は表から取る。横軸を名前で探さないのは、同じ計算を横軸の列名の違う表（「経過」と「塞がってからの時間」など）で使い回すため。
 */
export function chartFromCsv(
  text: string,
  table: Pick<TableChart, "data" | "tolerances">,
): { data: ChartData; warnings: string[] } {
  const warnings: string[] = [];
  const { data } = table;
  const lines = text
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), number: i + 1 }))
    .filter(({ line }) => line !== "" && !line.startsWith("#"));
  const headers = (lines[0]?.line ?? "").split(",").map((h) => h.trim());
  const columnIndex = (name: string): number | null => {
    const index = headers.indexOf(name);
    if (index === -1) {
      warnings.push(`CSV に列「${name}」がありません（CSV の列: ${headers.join(", ")}）`);
      return null;
    }
    return index;
  };
  const xIndex = headers.length > 1 ? 0 : null;
  if (xIndex === null) {
    warnings.push("CSV に横軸（1 列目）と線の列がありません");
  }
  const columns = data.series.map((s) => ({ key: s.key, index: columnIndex(s.label) }));
  if (xIndex === null || columns.some((c) => c.index === null)) {
    return { data: { ...data, points: [] }, warnings };
  }

  const points: ChartPoint[] = [];
  for (const { line, number } of lines.slice(1)) {
    const cells = line.split(",");
    const read = (index: number | null): number | null => {
      const cell = index === null ? "" : (cells[index]?.trim() ?? "");
      const value = cell === "" ? null : parseNumber(cell);
      if (cell !== "" && value === null) {
        warnings.push(`CSV の ${String(number)} 行目の「${cell}」は数値ではありません`);
      }
      return value;
    };
    const x = read(xIndex);
    if (x === null) {
      continue;
    }
    const values: Record<string, number> = {};
    for (const { key, index } of columns) {
      const value = read(index);
      if (value !== null) {
        values[key] = value;
      }
    }
    points.push({ x, values });
  }
  points.sort((a, b) => a.x - b.x);

  for (const s of data.series) {
    if (points.filter((p) => s.key in p.values).length < 2) {
      warnings.push(`CSV の「${s.label}」の点が 2 つ未満です`);
    }
  }
  // 表の値は CSV の値を表の桁で丸めたもののはずなので、差が桁の半分を超えたら片方だけ直したとみなす
  data.points.forEach((row, i) => {
    // 「85% 未満」だけの行のように、比べる値のない行は CSV に同じ時刻がなくてもよい
    if (Object.keys(row.values).length === 0) {
      return;
    }
    const at = points.find((p) => Math.abs(p.x - row.x) < 1e-9);
    if (at === undefined) {
      warnings.push(
        `CSV に「${data.xLabel}」が ${String(row.x)} の行がありません（表の行と突き合わせるため）`,
      );
      return;
    }
    for (const s of data.series) {
      const expected = row.values[s.key];
      if (expected === undefined) {
        continue;
      }
      const actual = at.values[s.key];
      const tolerance = table.tolerances[i]?.[s.key] ?? 0;
      if (actual === undefined || Math.abs(actual - expected) > tolerance + 1e-9) {
        warnings.push(
          `表と CSV が食い違っています: 「${data.xLabel}」${String(row.x)} の「${s.label}」が表は ${String(expected)}、CSV は ${actual === undefined ? "空欄" : String(actual)}`,
        );
      }
    }
  });
  return { data: { ...data, points }, warnings };
}

/** 表に付けた `data-chart` を読む。DB の中身を書き換えられた場合に備え、形を確かめてから使う。 */
export function readChartPayload(json: string): ChartPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const result = chartPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}
