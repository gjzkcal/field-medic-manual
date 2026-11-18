// AI が指定した条件（chart_create）から、グラフの点を作る。
// AI には条件だけを書かせ、点はここで計算する（AI が推移を計算すると、式や桁を間違えた線がそのまま出るため）。
// 薬の推移は、負傷者の画面と同じ関数（効能は effectAt と singleDosePeak、濃度は concentrationsAt）で出す。
import { dosesOf } from "@/features/casualties/casualty-view";
import {
  buildForecasts,
  concentrationsAt,
  effectAt,
  type Dose,
} from "@/features/casualties/forecast";
import { DRUG_LABELS } from "@/features/casualties/labels";
import { spokenDuration } from "@/features/chat/casualty-brief";
import type { ChartData, ChartSeries, ChartSpec } from "@/features/content/chart";
import { chartSummary } from "@/features/content/chart-summary";
import { DRUG_IDS, type DrugId } from "@/features/medication/ids";
import { doseExpirySeconds, drugConfig, singleDosePeak } from "@/features/medication/pharmacology";
import type { MedicationFile } from "@/features/medication/schema";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { ChartMetric } from "@/lib/bindings/ChartMetric";
import type { ChartRequest } from "@/lib/bindings/ChartRequest";

/** 1 つのグラフの線の上限。線の色が 5 色で、超えると同じ色の線ができる */
export const MAX_LINES = 5;
/** 縦軸の量の種類の上限。グラフは上下 2 つまで（1 つのグラフに縦軸を 2 本持たせない） */
const MAX_AXES = 2;
/** 薬の推移の点の間隔。負傷者の画面のグラフと同じ */
const STEP_SECONDS = 5;
const MS = 1000;
const X_LABEL = "経過";

const METRIC_LABELS: Record<ChartMetric, string> = { effect: "効能", concentration: "濃度" };

/** まとめる前の線 1 本。 */
export interface ChartLine {
  label: string;
  /**
   * 同じ縦軸に載せる線をまとめる鍵。効能は専用の鍵、ほか（濃度・原稿の線・利用者の数値）は単位ごとにまとめる。
   * 鍵を単位の文字そのものにしないのは、1 本のピークを 100 とした効能の % と、SpO2 などの % の値を同じ軸に載せないため。
   * 単位が同じ線どうしは同じ軸に載る（計算した濃度と原稿の濃度、2 人の心拍数を比べられるように。
   * 量の種類を AI に書かせても、合っているかを画面で確かめられない）
   */
  axis: string;
  unit: string | null;
  xLabel: string;
  /** 横軸の単位。時間は秒に直して `s`。線どうしで違うと 1 つのグラフにできない */
  xUnit: string | null;
  /** 値の出どころ。AI に返す要約に線ごとに書き、アプリが計算した値と原稿の値を取り違えないようにする */
  origin: string;
  points: readonly { x: number; y: number }[];
}

/** 条件 1 つ分の線。 */
export interface ChartPart {
  lines: ChartLine[];
  condition: string;
  /** 原稿の節から取った線なら、その節（グラフの下に、開くボタンを出す） */
  source: ChartSource | null;
}

export interface ChartSource {
  title: string;
  docId: string;
  anchor: string;
}

/** 画面に描くグラフ。 */
export interface AiChart {
  spec: ChartSpec;
  data: ChartData;
  /** グラフの下に出す条件（AI が何を指定したかを利用者が確かめられるように） */
  conditions: readonly string[];
  /** 線の値を取った原稿の節 */
  sources: readonly ChartSource[];
}

export type AiChartResult =
  { ok: true; chart: AiChart; summary: string } | { ok: false; error: string };

export interface AiChartInput {
  request: ChartRequest;
  medication: MedicationFile;
  casualties: readonly Casualty[];
  /** request.sections の節から取った線（節の HTML を読むのは chat-chart-sections。読めなかった節があれば、ここへ来る前に止める） */
  sections: readonly ChartPart[];
  /** Circulation を使っているか。使っていなければ薬の濃度の仕組みがないので、薬の推移は出さない（負傷者の画面と同じ） */
  circulation: boolean;
  nowMs: number;
}

function clockText(seconds: number): string {
  return seconds === 0 ? "0 秒" : spokenDuration(seconds * MS);
}

/**
 * 投与の一覧から、薬ごとの線を作る。横軸の 0 は atMs = 0。
 * buildForecasts を通さないのは、最後の投与の時点で消えていた投与が外され、指定した 1 本目が線から消えるため。
 */
function drugLines(
  medication: MedicationFile,
  doses: readonly Dose[],
  metric: ChartMetric,
  name: string,
): ChartLine[] {
  const endSeconds = Math.max(
    ...doses.map((d) => d.atMs / MS + doseExpirySeconds(drugConfig(medication, d.drug))),
  );
  const xs: number[] = [];
  for (let x = 0; x < endSeconds; x += STEP_SECONDS) {
    xs.push(x);
  }
  xs.push(endSeconds);
  return DRUG_IDS.filter((drug) => doses.some((d) => d.drug === drug)).map((drug) => {
    const peak = singleDosePeak(medication, drug);
    const value = (x: number): number =>
      metric === "effect"
        ? (Math.abs(effectAt(medication, drug, doses, x * MS)) / peak) * 100
        : (concentrationsAt(medication, doses, x * MS)[drug] ?? 0);
    return {
      label: `${DRUG_LABELS[drug]}（${name}）`,
      axis: metric === "effect" ? "effect" : "unit:nM",
      unit: metric === "effect" ? "%" : "nM",
      xLabel: X_LABEL,
      xUnit: "s",
      origin: "アプリの計算",
      points: xs.map((x) => ({ x, y: value(x) })),
    };
  });
}

function doseText(doses: readonly { drug: DrugId; seconds: number }[]): string {
  return doses
    .toSorted((a, b) => a.seconds - b.seconds)
    .map((d) => `${DRUG_LABELS[d.drug]} ${clockText(d.seconds)}`)
    .join("、");
}

function casualtyPart(
  input: AiChartInput,
  target: ChartRequest["casualties"][number],
): ChartPart | string {
  const casualty = input.casualties.find((c) => c.id === target.casualty);
  if (casualty === undefined) {
    const known = input.casualties.map((c) => `${c.name}（id: ${c.id}）`).join("、");
    return `id が ${target.casualty} の負傷者はいません。${known === "" ? "負傷者は記録されていません" : `記録されている負傷者: ${known}`}`;
  }
  const recorded = dosesOf(casualty.records);
  // 画面と同じく、最後の投与の時点で体内に残っている投与だけを使う（前に看た記録で、横軸が何時間にも伸びないように）
  const active =
    recorded.length === 0 ? [] : (buildForecasts(input.medication, recorded)[0]?.doses ?? []);
  if (active.length === 0) {
    return `負傷者「${casualty.name}」には、推移を計算できる薬の記録がありません`;
  }
  const startMs = Math.min(...active.map((d) => d.atMs));
  const doses = active.map((d) => ({ drug: d.drug, atMs: d.atMs - startMs }));
  return {
    lines: drugLines(input.medication, doses, target.metric, casualty.name),
    condition: `負傷者「${casualty.name}」の記録（${METRIC_LABELS[target.metric]}）: ${doseText(
      doses.map((d) => ({ drug: d.drug, seconds: Math.round(d.atMs / MS) })),
    )}。横軸の 0 は ${spokenDuration(input.nowMs - startMs)} 前の投与`,
    source: null,
  };
}

function unitText(unit: string | null): string {
  return unit ?? "単位なし";
}

/** 線を 1 つのグラフにまとめる。まとめられないときは、AI に返す理由の文。 */
export function composeChart(
  title: string,
  lines: readonly ChartLine[],
): { spec: ChartSpec; data: ChartData } | string {
  if (lines.length > MAX_LINES) {
    return `線が ${String(lines.length)} 本になります（薬ごと・節の線ごとに 1 本）。1 つのグラフは ${String(MAX_LINES)} 本までなので、条件を減らすか、グラフを分けてください`;
  }
  const axes = [...new Set(lines.map((l) => l.axis))];
  if (axes.length > MAX_AXES) {
    return `縦軸の量が ${String(axes.length)} 種類あります。1 つのグラフは ${String(MAX_AXES)} 種類までなので、グラフを分けてください`;
  }
  const first = lines[0];
  if (first === undefined) {
    return "線がありません";
  }
  const other = lines.find((l) => l.xUnit !== first.xUnit);
  if (other !== undefined) {
    return `横軸の単位が合いません（「${first.label}」は ${unitText(first.xUnit)}、「${other.label}」は ${unitText(other.xUnit)}）。同じ横軸の線だけを 1 つのグラフにしてください`;
  }
  const differs = lines.find((l) => l.xLabel !== first.xLabel);
  // 時間どうしなら、節ごとに違う見出し（「付けてからの時間」など）を「経過」にまとめてよい。
  // 時間でない横軸は、単位が同じでも別の量かもしれない（出血量と輸液量）ので、まとめない
  if (differs !== undefined && first.xUnit !== "s") {
    return `横軸が違います（「${first.label}」は ${first.xLabel}、「${differs.label}」は ${differs.xLabel}）。同じ横軸の線だけを 1 つのグラフにしてください`;
  }
  const xLabel = differs === undefined ? first.xLabel : X_LABEL;
  // 同じ横軸の点が 2 つあると、後の値が前の値を黙って上書きする（表の「1 分」と「60 秒」は、どちらも 60 秒になる）
  for (const line of lines) {
    const seen = new Set<number>();
    const twice = line.points.find((p) => seen.size === seen.add(p.x).size);
    if (twice !== undefined) {
      return `「${line.label}」に、横軸が同じ点が 2 つあります（${line.xLabel} ${String(twice.x)}${line.xUnit === null ? "" : ` ${line.xUnit}`}）。横軸ごとに 1 点の線だけをグラフにできます`;
    }
  }
  const short = lines.find((l) => l.points.length < 2);
  if (short !== undefined) {
    return `「${short.label}」の点が 2 つ未満です`;
  }
  const series: ChartSeries[] = lines.map((line, index) => ({
    key: `s${String(index)}`,
    label: line.label,
    panel: line.axis === axes[0] ? "y" : "y2",
    unit: line.unit,
  }));
  const rows = new Map<number, Record<string, number>>();
  for (const [index, line] of lines.entries()) {
    for (const point of line.points) {
      rows.set(point.x, { ...rows.get(point.x), [`s${String(index)}`]: point.y });
    }
  }
  const labelsOf = (panel: ChartSeries["panel"]): string[] =>
    series.filter((s) => s.panel === panel).map((s) => s.label);
  return {
    spec: {
      x: xLabel,
      y: labelsOf("y"),
      y2: labelsOf("y2"),
      ref: [],
      title,
      data: null,
      unit: null,
    },
    data: {
      xLabel,
      xUnit: first.xUnit,
      series,
      points: [...rows.entries()]
        .toSorted(([a], [b]) => a - b)
        .map(([x, values]) => ({ x, values })),
    },
  };
}

/** 条件からグラフを作る。作れないときは、AI が条件を直せるように理由を返す。 */
export function buildAiChart(input: AiChartInput): AiChartResult {
  const { request, medication } = input;
  if (!input.circulation && request.scenarios.length + request.casualties.length > 0) {
    return {
      ok: false,
      error:
        "薬の推移は、Circulation を使っているときだけ計算できます（利用者の設定の「使っている MOD」に Circulation がありません）",
    };
  }
  const parts: ChartPart[] = [];
  for (const scenario of request.scenarios) {
    parts.push({
      lines: drugLines(
        medication,
        scenario.doses.map((d) => ({ drug: d.drug, atMs: d.seconds * MS })),
        scenario.metric,
        scenario.label,
      ),
      condition: `仮の投与「${scenario.label}」（${METRIC_LABELS[scenario.metric]}）: ${doseText(scenario.doses)}`,
      source: null,
    });
  }
  for (const target of request.casualties) {
    const part = casualtyPart(input, target);
    if (typeof part === "string") {
      return { ok: false, error: part };
    }
    parts.push(part);
  }
  parts.push(...input.sections);
  for (const values of request.values) {
    const scale = values.minutes ? 60 : 1;
    parts.push({
      lines: [
        {
          label: values.label,
          axis: `unit:${values.unit}`,
          unit: values.unit === "" ? null : values.unit,
          xLabel: X_LABEL,
          xUnit: "s",
          origin: "利用者が示した数値",
          points: values.points.map((p) => ({ x: p.x * scale, y: p.y })),
        },
      ],
      condition: `利用者が示した数値「${values.label}」: ${String(values.points.length)} 点`,
      source: null,
    });
  }
  const allLines = parts.flatMap((p) => p.lines);
  const composed = composeChart(request.title, allLines);
  if (typeof composed === "string") {
    return { ok: false, error: composed };
  }
  const conditions = parts.map((p) => p.condition);
  // 同じ節を 2 つの指定で使っても、開くボタンは 1 つにする
  const sources = new Map<string, ChartSource>();
  for (const { source } of parts) {
    if (source !== null) {
      sources.set(`${source.docId}#${source.anchor}`, source);
    }
  }
  return {
    ok: true,
    chart: { ...composed, conditions, sources: [...sources.values()] },
    summary: [
      "線ごとの値と、値の出どころ:",
      // 値と出どころを同じ行に書く（名前の同じ線があっても、どの値がどこから来たかを取り違えないように）
      ...composed.data.series.map(
        (series, index) =>
          `- ${chartSummary({ ...composed.data, series: [series] })}［値の出どころ: ${allLines[index]?.origin ?? ""}］`,
      ),
      "条件:",
      ...conditions.map((c) => `- ${c}`),
    ].join("\n"),
  };
}
