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
   * 同じ縦軸に載せてよい量かを見分ける鍵。単位の文字では分けない
   * （効能の % と SpO2 の % のように、同じ単位でも別の量を同じ軸に載せないため）
   */
  axis: string;
  unit: string | null;
  /** x は秒 */
  points: readonly { x: number; y: number }[];
}

/** 画面に描くグラフ。 */
export interface AiChart {
  spec: ChartSpec;
  data: ChartData;
  /** グラフの下に出す条件（AI が何を指定したかを利用者が確かめられるように） */
  conditions: readonly string[];
}

export type AiChartResult =
  { ok: true; chart: AiChart; summary: string } | { ok: false; error: string };

export interface AiChartInput {
  request: ChartRequest;
  medication: MedicationFile;
  casualties: readonly Casualty[];
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
      axis: metric,
      unit: metric === "effect" ? "%" : "nM",
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

interface Part {
  lines: ChartLine[];
  condition: string;
}

function casualtyPart(
  input: AiChartInput,
  target: ChartRequest["casualties"][number],
): Part | string {
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
  };
}

/** 線を 1 つのグラフにまとめる。まとめられないときは、AI に返す理由の文。 */
export function composeChart(
  title: string,
  lines: readonly ChartLine[],
): { spec: ChartSpec; data: ChartData } | string {
  if (lines.length > MAX_LINES) {
    return `線が ${String(lines.length)} 本になります（薬ごとに 1 本）。1 つのグラフは ${String(MAX_LINES)} 本までなので、条件を減らすか、グラフを分けてください`;
  }
  const axes = [...new Set(lines.map((l) => l.axis))];
  if (axes.length > MAX_AXES) {
    return `縦軸の量が ${String(axes.length)} 種類あります。1 つのグラフは ${String(MAX_AXES)} 種類までなので、グラフを分けてください`;
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
      x: X_LABEL,
      y: labelsOf("y"),
      y2: labelsOf("y2"),
      ref: [],
      title,
      data: null,
      unit: null,
    },
    data: {
      xLabel: X_LABEL,
      xUnit: "s",
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
  const parts: Part[] = [];
  for (const scenario of request.scenarios) {
    parts.push({
      lines: drugLines(
        medication,
        scenario.doses.map((d) => ({ drug: d.drug, atMs: d.seconds * MS })),
        scenario.metric,
        scenario.label,
      ),
      condition: `仮の投与「${scenario.label}」（${METRIC_LABELS[scenario.metric]}）: ${doseText(scenario.doses)}`,
    });
  }
  for (const target of request.casualties) {
    const part = casualtyPart(input, target);
    if (typeof part === "string") {
      return { ok: false, error: part };
    }
    parts.push(part);
  }
  for (const values of request.values) {
    const scale = values.minutes ? 60 : 1;
    parts.push({
      lines: [
        {
          label: values.label,
          axis: `unit:${values.unit}`,
          unit: values.unit === "" ? null : values.unit,
          points: values.points.map((p) => ({ x: p.x * scale, y: p.y })),
        },
      ],
      condition: `利用者が示した数値「${values.label}」: ${String(values.points.length)} 点`,
    });
  }
  const composed = composeChart(
    request.title,
    parts.flatMap((p) => p.lines),
  );
  if (typeof composed === "string") {
    return { ok: false, error: composed };
  }
  const conditions = parts.map((p) => p.condition);
  return {
    ok: true,
    chart: { ...composed, conditions },
    summary: [chartSummary(composed.data), "条件:", ...conditions.map((c) => `- ${c}`)].join("\n"),
  };
}
