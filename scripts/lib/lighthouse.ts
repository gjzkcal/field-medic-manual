// Web 版の Lighthouse の結果（Lighthouse の JSON のレポート）を、ページ × 端末ごとの中央値の表にまとめ、合否を決める。
// 計測そのもの（ブラウザの起動）は scripts/lighthouse.ts。

import { z } from "zod";

/** 測るカテゴリ。Lighthouse の JSON の categories のキー */
export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * 100 を切ったら失敗にするカテゴリ。Performance は CI のランナーの速さで数点ぶれるので、記録だけにする。
 * ほかの 3 つはページの中身で決まり、ぶれない
 */
export const GATED: readonly Category[] = ["accessibility", "best-practices", "seo"];

export const FORM_FACTORS = ["mobile", "desktop"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/** 表に出す指標。Lighthouse の audits のキーと表の見出し */
export const METRICS = [
  ["first-contentful-paint", "FCP"],
  ["largest-contentful-paint", "LCP"],
  ["total-blocking-time", "TBT"],
  ["cumulative-layout-shift", "CLS"],
] as const;
type MetricId = (typeof METRICS)[number][0];

// 使うところだけを読む。Lighthouse の版が変わって形が違えば、ここで気づけるようにする
const auditSchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().nullable(),
  scoreDisplayMode: z.string(),
  numericValue: z.number().optional(),
});
const reportSchema = z.object({
  lighthouseVersion: z.string(),
  categories: z.record(
    z.string(),
    z.object({
      score: z.number().nullable(),
      auditRefs: z.array(z.object({ id: z.string() })),
    }),
  ),
  audits: z.record(z.string(), auditSchema),
});
export type Report = z.infer<typeof reportSchema>;

export function parseReport(json: string): Report {
  return reportSchema.parse(JSON.parse(json));
}

export interface Run {
  page: string;
  formFactor: FormFactor;
  report: Report;
}

export interface Row {
  page: string;
  formFactor: FormFactor;
  runs: number;
  /** 0〜100 */
  scores: Record<Category, number>;
  metrics: Record<MetricId, number>;
  /** 判定するカテゴリで満点でない監査（どれかの回で落ちたもの）。直すときの手がかり */
  failedAudits: string[];
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("値がありません");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function categoryScore(report: Report, category: Category): number {
  const score = report.categories[category]?.score;
  if (score === undefined) {
    throw new Error(`レポートに ${category} のカテゴリがありません`);
  }
  // 測れなかったときは null になる。満点扱いにせず 0 にして、失敗に気づけるようにする
  return Math.round((score ?? 0) * 100);
}

function metricValue(report: Report, id: MetricId): number {
  const value = report.audits[id]?.numericValue;
  if (value === undefined) {
    throw new Error(`レポートに ${id} の値がありません`);
  }
  return value;
}

function failedAudits(report: Report): string[] {
  const failed: string[] = [];
  for (const category of GATED) {
    for (const ref of report.categories[category]?.auditRefs ?? []) {
      const audit = report.audits[ref.id];
      // 情報だけの監査と、当てはまらない監査は点数を持たない
      if (audit?.score !== undefined && audit.score !== null && audit.score < 1) {
        failed.push(`${category}: ${audit.id}（${audit.title}）`);
      }
    }
  }
  return failed;
}

/** ページ × 端末ごとに中央値をとる。並びは渡した回の順（初めに出てきた順） */
export function summarize(runs: readonly Run[]): Row[] {
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const key = `${run.page}\n${run.formFactor}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const [first] = group;
    if (first === undefined) {
      throw new Error("空のグループがあります");
    }
    const reports = group.map((run) => run.report);
    const score = (category: Category): number =>
      median(reports.map((r) => categoryScore(r, category)));
    const metric = (id: MetricId): number => median(reports.map((r) => metricValue(r, id)));
    return {
      page: first.page,
      formFactor: first.formFactor,
      runs: group.length,
      scores: {
        performance: score("performance"),
        accessibility: score("accessibility"),
        "best-practices": score("best-practices"),
        seo: score("seo"),
      },
      metrics: {
        "first-contentful-paint": metric("first-contentful-paint"),
        "largest-contentful-paint": metric("largest-contentful-paint"),
        "total-blocking-time": metric("total-blocking-time"),
        "cumulative-layout-shift": metric("cumulative-layout-shift"),
      },
      failedAudits: [...new Set(reports.flatMap(failedAudits))].sort(),
    };
  });
}

/** 判定するカテゴリの中央値が 100 を切った行 */
export function failingRows(rows: readonly Row[]): Row[] {
  return rows.filter((row) => GATED.some((c) => row.scores[c] < 100));
}

function formatMetric(id: MetricId, value: number): string {
  return id === "cumulative-layout-shift" ? value.toFixed(3) : `${(value / 1000).toFixed(1)} s`;
}

/** ジョブの概要（GitHub の Markdown）に出す表 */
export function toMarkdown(rows: readonly Row[], lighthouseVersion: string): string {
  const header = [
    "ページ",
    "端末",
    "Perf",
    "A11y",
    "BP",
    "SEO",
    ...METRICS.map(([, label]) => label),
  ];
  const lines = [
    `## Lighthouse ${lighthouseVersion}（各 ${String(rows[0]?.runs ?? 0)} 回の中央値）`,
    "",
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => {
      const cells = [
        row.page,
        row.formFactor === "mobile" ? "モバイル" : "デスクトップ",
        ...CATEGORIES.map((c) => String(row.scores[c])),
        ...METRICS.map(([id]) => formatMetric(id, row.metrics[id])),
      ];
      return `| ${cells.join(" | ")} |`;
    }),
  ];
  const failing = failingRows(rows);
  if (failing.length > 0) {
    lines.push("", "### 100 を切ったカテゴリ（A11y・BP・SEO）", "");
    for (const row of failing) {
      lines.push(`- ${row.page}（${row.formFactor}）`);
      lines.push(...row.failedAudits.map((audit) => `  - ${audit}`));
    }
  }
  return `${lines.join("\n")}\n`;
}
