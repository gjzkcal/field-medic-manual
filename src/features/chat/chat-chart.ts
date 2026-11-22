// AI が指定した条件（chart_create）から、グラフの点を作る。
// AI には条件だけを書かせ、点はここで計算する（AI が推移を計算すると、式や桁を間違えた線がそのまま出るため）。
// 薬ごとの推移は、負傷者の画面と同じ関数（効能は effectAt と singleDosePeak、濃度は concentrationsAt）で出す。
// 心拍数・血圧・SpO2 は、ゲームと同じく 1 s ごとに進める計算（simulateVitals）で出す。
import { dosesOf } from "@/features/casualties/casualty-view";
import {
  buildForecasts,
  concentrationsAt,
  effectAt,
  type Dose,
} from "@/features/casualties/forecast";
import { DRUG_LABELS } from "@/features/casualties/labels";
import {
  bloodPressureMmhg,
  kpaToMmhg,
  simulateVitals,
  type PatientChange,
  type PatientState,
  type VitalsPoint,
} from "@/features/casualties/vitals";
import { spokenDuration } from "@/features/chat/casualty-brief";
import type { ChartData, ChartSeries, ChartSpec } from "@/features/content/chart";
import { chartSummary } from "@/features/content/chart-summary";
import { DRUG_IDS, type DrugId } from "@/features/medication/ids";
import { doseExpirySeconds, drugConfig, singleDosePeak } from "@/features/medication/pharmacology";
import type { MedicationFile } from "@/features/medication/schema";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { ChartChange } from "@/lib/bindings/ChartChange";
import type { ChartMetric } from "@/lib/bindings/ChartMetric";
import type { ChartPatient } from "@/lib/bindings/ChartPatient";
import type { ChartRequest } from "@/lib/bindings/ChartRequest";

/** 1 つのグラフの線の上限。線の色が 5 色で、超えると同じ色の線ができる */
export const MAX_LINES = 5;
/** 縦軸の量の種類の上限。グラフは上下 2 つまで（1 つのグラフに縦軸を 2 本持たせない） */
const MAX_AXES = 2;
/** 薬の推移の点の間隔。負傷者の画面のグラフと同じ */
const STEP_SECONDS = 5;
const MS = 1000;
const X_LABEL = "経過";

const PERCENT = 100;
const ORIGIN = "アプリの計算";

const METRIC_LABELS: Record<ChartMetric, string> = {
  effect: "効能",
  concentration: "濃度",
  heart_rate: "心拍数",
  blood_pressure: "血圧",
  mean_pressure: "平均血圧",
  spo2: "SpO2",
};

/** 薬ごとに 1 本の線になる量。ほかの量は、打った薬をすべて合わせた患者の値で、条件ごとの線になる */
type DrugMetric = "effect" | "concentration";
type VitalMetric = Exclude<ChartMetric, DrugMetric>;

function isVitalMetric(metric: ChartMetric): metric is VitalMetric {
  return metric !== "effect" && metric !== "concentration";
}

interface VitalLineSpec {
  name: string;
  unit: string;
  value: (point: VitalsPoint) => number;
}

/** 心拍数・血圧・SpO2 の線。1 つの量から 1 本か 2 本 */
const VITAL_LINES: Record<VitalMetric, readonly VitalLineSpec[]> = {
  heart_rate: [{ name: "心拍数", unit: "bpm", value: (p) => p.heartRate }],
  blood_pressure: [
    {
      name: "収縮期血圧",
      unit: "mmHg",
      value: (p) => bloodPressureMmhg(p.meanPressureKpa).systolic,
    },
    {
      name: "拡張期血圧",
      unit: "mmHg",
      value: (p) => bloodPressureMmhg(p.meanPressureKpa).diastolic,
    },
  ],
  mean_pressure: [{ name: "平均血圧", unit: "mmHg", value: (p) => kpaToMmhg(p.meanPressureKpa) }],
  // 縦軸の鍵は単位の %（原稿の節の SpO2 の線と同じ軸に載る。効能の % は別の鍵）。
  // Breathing がなければ値がないが、その場合は線を作る前に理由を返して止めている
  spo2: [{ name: "SpO2", unit: "%", value: (p) => p.spo2 ?? Number.NaN }],
};

/** 仮の投与・負傷者の記録に共通の、患者の値の計算の指定 */
interface VitalTarget {
  patient: ChartPatient;
  changes: readonly ChartChange[];
}

function patientOf(patient: ChartPatient): PatientState {
  return {
    blood: patient.blood / PERCENT,
    painHealth: patient.pain / PERCENT,
    airwayBlocked: patient.blocked,
    pneumothorax: patient.pneumothorax / PERCENT,
    tension: patient.tension,
    mask: patient.mask,
  };
}

function changeOf(change: ChartChange): PatientChange {
  return {
    seconds: change.seconds,
    patch: {
      ...(change.blood === null ? {} : { blood: change.blood / PERCENT }),
      ...(change.pain === null ? {} : { painHealth: change.pain / PERCENT }),
      ...(change.blocked === null ? {} : { airwayBlocked: change.blocked }),
      ...(change.pneumothorax === null ? {} : { pneumothorax: change.pneumothorax / PERCENT }),
      ...(change.tension === null ? {} : { tension: change.tension }),
      ...(change.mask === null ? {} : { mask: change.mask }),
    },
  };
}

/** Breathing がないと計算に効かない指定（気道・気胸・酸素マスク）があるか。 */
function needsBreathing(target: VitalTarget): boolean {
  const { patient } = target;
  return (
    patient.blocked ||
    patient.pneumothorax > 0 ||
    patient.tension ||
    patient.mask ||
    target.changes.some(
      (c) => c.blocked !== null || c.pneumothorax !== null || c.tension !== null || c.mask !== null,
    )
  );
}

/** 気胸が関わる指定があるか（悪化を計算に入れていないことを、条件の文に書くため）。 */
function involvesPneumothorax(target: VitalTarget): boolean {
  return (
    target.patient.pneumothorax > 0 ||
    target.patient.tension ||
    target.changes.some((c) => (c.pneumothorax ?? 0) > 0 || c.tension === true)
  );
}

function patientText(patient: ChartPatient): string {
  return [
    `血液量 ${String(patient.blood)}%`,
    `痛みの HP ${String(patient.pain)}%`,
    ...(patient.blocked ? ["気道が塞がっている（0 s から）"] : []),
    ...(patient.pneumothorax > 0 ? [`気胸の大きさ ${String(patient.pneumothorax)}%`] : []),
    ...(patient.tension ? ["緊張性気胸"] : []),
    ...(patient.mask ? ["酸素マスクあり"] : []),
  ].join("、");
}

function changeText(change: ChartChange): string {
  const items = [
    ...(change.blood === null ? [] : [`血液量 ${String(change.blood)}%`]),
    ...(change.pain === null ? [] : [`痛みの HP ${String(change.pain)}%`]),
    ...(change.blocked === null ? [] : [change.blocked ? "気道が塞がる" : "気道を確保"]),
    ...(change.pneumothorax === null ? [] : [`気胸の大きさ ${String(change.pneumothorax)}%`]),
    ...(change.tension === null ? [] : [change.tension ? "緊張性気胸になる" : "緊張性気胸を解除"]),
    ...(change.mask === null ? [] : [change.mask ? "酸素マスクを付ける" : "酸素マスクを外す"]),
  ];
  return `経過 ${String(change.seconds)} s から ${items.join("・")}`;
}

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
  /** Circulation を使っているか。使っていなければ薬の濃度の仕組みがないので、投与からの推移は出さない（負傷者の画面と同じ） */
  circulation: boolean;
  /** Breathing を使っているか。使っていなければ、SpO2 と、気道・気胸・酸素マスクの指定は受けない */
  breathing: boolean;
  nowMs: number;
}

function clockText(seconds: number): string {
  return seconds === 0 ? "0 秒" : spokenDuration(seconds * MS);
}

/**
 * 線を描く終わりの時刻（秒）。until が 0 なら、すべての投与が体内から消える時刻。それより先は描かない。
 * 薬がなければ、消える時刻がないので until まで（薬なしで until が 0 の条件は、Rust の検査が通さない）
 */
function endSecondsOf(medication: MedicationFile, doses: readonly Dose[], until: number): number {
  if (doses.length === 0) {
    return until;
  }
  const clear = Math.max(
    ...doses.map((d) => d.atMs / MS + doseExpirySeconds(drugConfig(medication, d.drug))),
  );
  return until === 0 ? clear : Math.min(clear, until);
}

/**
 * 投与の一覧から、薬ごとの線を作る。横軸の 0 は atMs = 0。
 * buildForecasts を通さないのは、最後の投与の時点で消えていた投与が外され、指定した 1 本目が線から消えるため。
 */
function drugLines(
  medication: MedicationFile,
  doses: readonly Dose[],
  metric: DrugMetric,
  name: string,
  endSeconds: number,
): ChartLine[] {
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
      origin: ORIGIN,
      points: xs.map((x) => ({ x, y: value(x) })),
    };
  });
}

/**
 * 体内にある間がつながっている投与を、ひとまとまりにする（古い順）。
 * まとまりの間は、薬がすべて体内から消えているので、心拍数は患者の状態だけの値に戻っている。
 */
function doseGroups(medication: MedicationFile, doses: readonly Dose[]): Dose[][] {
  const groups: Dose[][] = [];
  let clearMs = Number.NEGATIVE_INFINITY;
  for (const dose of doses.toSorted((a, b) => a.atMs - b.atMs)) {
    const last = groups.at(-1);
    if (last === undefined || dose.atMs >= clearMs) {
      groups.push([dose]);
    } else {
      last.push(dose);
    }
    clearMs = Math.max(
      clearMs,
      dose.atMs + doseExpirySeconds(drugConfig(medication, dose.drug)) * MS,
    );
  }
  return groups;
}

/** まとまりの最初の投与の時刻（整数の秒に切り下げ）。 */
function groupStartSeconds(group: readonly Dose[]): number {
  return Math.floor(Math.min(...group.map((d) => d.atMs)) / MS);
}

/**
 * 投与と患者の状態から、心拍数・血圧・SpO2 の線を量ごとに作る。作れないときは、AI に返す理由の文。
 * 計算は 1 s ごとだが、点は薬の線と同じ間隔に間引く。線ごとの最大と最小の時刻は残す
 * （AI に返す最大・最小の値が、間引きでずれないように）。
 *
 * earlier は、負傷者の記録にある前の投与（最後の投与の時点で消えていて、薬ごとの線からは外した分）。
 * 心拍数と状態は前の値に依存するので、薬ごとの線と違って、前の投与から計算し直してから描く範囲を切り出す
 * （外したままだと、まだ体内に残っている分の効果と、前の投与で当たった心停止が、計算から抜ける）。
 */
function vitalLines(
  medication: MedicationFile,
  doses: readonly Dose[],
  earlier: readonly Dose[],
  metrics: readonly VitalMetric[],
  target: VitalTarget,
  name: string,
  endSeconds: number,
  breathing: boolean,
): { lines: Map<VitalMetric, ChartLine[]>; note: string } | string {
  const state = patientText(target.patient);
  const base = { medication, patient: patientOf(target.patient), breathing };
  if (simulateVitals({ ...base, doses: [], endSeconds: 0 }).arrestAtSeconds !== null) {
    return `「${name}」の患者の状態（${state}）では、薬を打つ前に心停止になっていて、推移を計算できません`;
  }
  const earlierArrest = `「${name}」は、記録にある前の投与で心停止に当たっています（グラフの始まりより前）。蘇生は計算に入っていないので、その後の心拍数・血圧は計算できません`;
  // 横軸の 0 までに薬がすべて消えているまとまりは、心停止に当たったかだけを見る（心拍数は、患者の状態だけの値に戻っている）。
  // 0 より後まで残るまとまりは、間が空いていても全部を続けて計算する（仮の投与で、前の薬が消えてから次を打つ場合も線に出す）
  const groups = doseGroups(medication, [...earlier, ...doses]);
  const endsBeforeStart = (group: readonly Dose[]): boolean =>
    endSecondsOf(medication, group, 0) <= 0;
  for (const group of groups.filter((g) => endsBeforeStart(g))) {
    const past = simulateVitals({
      ...base,
      doses: group,
      startSeconds: groupStartSeconds(group),
      endSeconds: Math.ceil(endSecondsOf(medication, group, 0)),
    });
    if (past.arrestAtSeconds !== null) {
      return earlierArrest;
    }
  }
  const current = groups.filter((g) => !endsBeforeStart(g)).flat();
  // 描く範囲を超える点を出さないように、終わりは切り下げる（負傷者の記録の投与は、間隔に小数の秒が入る）
  const { points, unconsciousAtSeconds, arrestAtSeconds } = simulateVitals({
    ...base,
    doses: current,
    changes: target.changes.map((c) => changeOf(c)),
    startSeconds: current.length === 0 ? 0 : Math.min(0, groupStartSeconds(current)),
    endSeconds: Math.floor(endSeconds),
  });
  // 患者の状態だけでは心停止にならないと上で確かめたので、0 s までの心停止は、前の投与によるもの
  if (arrestAtSeconds !== null && arrestAtSeconds <= 0) {
    return earlierArrest;
  }
  const carried = current.filter((dose) => earlier.includes(dose));
  // 心拍数と血圧は、心停止の後は 0 のままなので、心停止の時刻で線を終える。
  // SpO2 は心停止の後も下がり続けるので、終わりまで描く（Breathing がなければ、点そのものが心停止で終わっている）
  const lineOf = (metric: VitalMetric, spec: VitalLineSpec): ChartLine => {
    const visible =
      metric === "spo2" || arrestAtSeconds === null
        ? points
        : points.filter((p) => p.seconds <= arrestAtSeconds);
    const kept = new Set<VitalsPoint>([
      ...visible.filter((p, i) => p.seconds % STEP_SECONDS === 0 || i === visible.length - 1),
      visible.reduce((a, b) => (spec.value(b) > spec.value(a) ? b : a)),
      visible.reduce((a, b) => (spec.value(b) < spec.value(a) ? b : a)),
    ]);
    return {
      label: `${spec.name}（${name}）`,
      axis: `unit:${spec.unit}`,
      unit: spec.unit,
      xLabel: X_LABEL,
      xUnit: "s",
      origin: ORIGIN,
      points: visible.filter((p) => kept.has(p)).map((p) => ({ x: p.seconds, y: spec.value(p) })),
    };
  };
  const events: string[] = [];
  if (carried.length > 0) {
    events.push(
      `記録にある前の投与（${[...new Set(carried.map((d) => DRUG_LABELS[d.drug]))].join("、")}）も、体内に残っている間の分を計算に入れている`,
    );
  }
  if (unconsciousAtSeconds === 0) {
    events.push("グラフの始まりの時点で意識がない");
  } else if (unconsciousAtSeconds !== null && unconsciousAtSeconds !== arrestAtSeconds) {
    events.push(`経過 ${String(unconsciousAtSeconds)} s で意識を失う`);
  }
  if (arrestAtSeconds !== null) {
    events.push(
      breathing
        ? `経過 ${String(arrestAtSeconds)} s で心停止になる（心拍数と血圧の線はそこで終わる。SpO2 は、CPR をしない前提でその後も続く）`
        : `経過 ${String(arrestAtSeconds)} s で心停止になり、線はそこで終わる`,
    );
  }
  if (breathing && involvesPneumothorax(target)) {
    events.push("気胸の悪化は計算に入れていない");
  }
  const changes =
    target.changes.length === 0
      ? "（計算の間は一定）"
      : `。途中の変更: ${target.changes.map((c) => changeText(c)).join("、")}`;
  return {
    lines: new Map(
      metrics.map((metric) => [metric, VITAL_LINES[metric].map((spec) => lineOf(metric, spec))]),
    ),
    note: `患者の状態: ${state}${changes}${events.length === 0 ? "" : `。${events.join("、")}`}`,
  };
}

interface DoseParts {
  lines: ChartLine[];
  /** 条件の文に書く、量の名前 */
  metricText: string;
  /** 条件の文の終わりに足す文。なければ空 */
  note: string;
}

/** 1 つの条件（投与の一覧）から、選ばれた量の線を作る。線は、AI が量を並べた順にする。 */
function doseParts(
  medication: MedicationFile,
  doses: readonly Dose[],
  target: VitalTarget & { metrics: readonly ChartMetric[]; until: number },
  name: string,
  breathing: boolean,
  earlier: readonly Dose[] = [],
): DoseParts | string {
  if (!breathing && (target.metrics.includes("spo2") || needsBreathing(target))) {
    return "SpO2 と、気道・気胸・酸素マスクの指定は、Breathing を使っているときだけ計算できます（利用者の設定の「使っている MOD」に Breathing がありません）";
  }
  const endSeconds = endSecondsOf(medication, doses, target.until);
  const range = target.until === 0 ? "" : `。経過 ${String(endSeconds)} s まで`;
  const vitalMetrics = target.metrics.filter(isVitalMetric);
  const vitals =
    vitalMetrics.length === 0
      ? null
      : vitalLines(medication, doses, earlier, vitalMetrics, target, name, endSeconds, breathing);
  if (typeof vitals === "string") {
    return vitals;
  }
  return {
    lines: target.metrics.flatMap((metric) =>
      isVitalMetric(metric)
        ? (vitals?.lines.get(metric) ?? [])
        : drugLines(medication, doses, metric, name, endSeconds),
    ),
    metricText: target.metrics.map((m) => METRIC_LABELS[m]).join("・"),
    note: vitals === null ? range : `${range}。${vitals.note}`,
  };
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
  const shift = (d: Dose): Dose => ({ drug: d.drug, atMs: d.atMs - startMs });
  const doses = active.map((d) => shift(d));
  const earlier = recorded.filter((d) => !active.includes(d)).map((d) => shift(d));
  const made = doseParts(input.medication, doses, target, casualty.name, input.breathing, earlier);
  if (typeof made === "string") {
    return made;
  }
  return {
    lines: made.lines,
    condition: `負傷者「${casualty.name}」の記録（${made.metricText}）: ${doseText(
      doses.map((d) => ({ drug: d.drug, seconds: Math.round(d.atMs / MS) })),
    )}。横軸の 0 は ${spokenDuration(input.nowMs - startMs)} 前の投与${made.note}`,
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
        "投与からの推移は、Circulation を使っているときだけ計算できます（利用者の設定の「使っている MOD」に Circulation がありません）",
    };
  }
  const parts: ChartPart[] = [];
  for (const scenario of request.scenarios) {
    const made = doseParts(
      medication,
      scenario.doses.map((d) => ({ drug: d.drug, atMs: d.seconds * MS })),
      scenario,
      scenario.label,
      input.breathing,
    );
    if (typeof made === "string") {
      return { ok: false, error: made };
    }
    parts.push({
      lines: made.lines,
      condition: `仮の投与「${scenario.label}」（${made.metricText}）: ${scenario.doses.length === 0 ? "薬なし" : doseText(scenario.doses)}${made.note}`,
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
