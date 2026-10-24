// Web 版の Lighthouse の結果（Lighthouse の JSON のレポート）を、ページ × 端末ごとの中央値の表にまとめ、合否を決める。
// 計測そのもの（ブラウザの起動）は scripts/lighthouse.ts。
// 合否は全ページの A11y・BP・SEO だけ、性能は本番の代表ページの Performance だけを測るので、
// どちらのレポートにも全カテゴリがそろうとは限らない。表と判定は、測ったカテゴリ・指標だけを扱う。

import { z } from "zod";

/** 測るカテゴリ。Lighthouse の JSON の categories のキー */
export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * 100 を切ったら失敗にするカテゴリ。Performance は計測する環境の速さで数点ぶれるので、記録だけにする。
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

/** 全ページの表をこれより多い行で畳む（ジョブの概要で、失敗の一覧が表に埋もれないように） */
const FOLD_ROWS = 12;

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
      // 重みが 0 の監査（valid-source-maps など）は、落ちてもカテゴリの点数に効かない
      auditRefs: z.array(z.object({ id: z.string(), weight: z.number() })),
    }),
  ),
  audits: z.record(z.string(), auditSchema),
});
export type Report = z.infer<typeof reportSchema>;

export function parseReport(json: string): Report {
  return reportSchema.parse(JSON.parse(json));
}

/**
 * Web 版のビルド（dist-web）の HTML の一覧から、測るページ（base より後ろのパス）を作る。
 * ビルドは既知のルートと原稿ごとに index.html の写しを置くので、原稿を足せば測る対象にも入る。
 * index.html は /library へ移るだけ、404.html は無い URL のためのものなので測らない
 */
export function pagesFromBuild(htmlFiles: readonly string[]): string[] {
  return htmlFiles
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".html") && file !== "index.html" && file !== "404.html")
    .map((file) => file.slice(0, -".html".length))
    .sort((a, b) => {
      const depth = a.split("/").length - b.split("/").length;
      return depth !== 0 ? depth : a.localeCompare(b);
    });
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
  /** 0〜100。測ったカテゴリだけ */
  scores: Partial<Record<Category, number>>;
  /** 測った指標だけ */
  metrics: Partial<Record<MetricId, number>>;
  /** 判定するカテゴリで満点でなく、点数に効く監査（どれかの回で落ちたもの）。直すときの手がかり */
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
      if (ref.weight === 0) {
        continue;
      }
      const audit = report.audits[ref.id];
      // 情報だけの監査と、当てはまらない監査は点数を持たない
      if (audit?.score !== undefined && audit.score !== null && audit.score < 1) {
        failed.push(`${category}: ${audit.id}（${audit.title}）`);
      }
    }
  }
  return failed;
}

/**
 * ページ × 端末ごとに中央値をとる。並びは渡した回の順（初めに出てきた順）。
 * カテゴリと指標は、グループの最初の回にあるものを測ったとみなし、ほかの回に無ければ例外にする
 */
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
    const scores: Row["scores"] = {};
    for (const category of CATEGORIES) {
      if (first.report.categories[category] !== undefined) {
        scores[category] = median(reports.map((r) => categoryScore(r, category)));
      }
    }
    const metrics: Row["metrics"] = {};
    for (const [id] of METRICS) {
      if (first.report.audits[id]?.numericValue !== undefined) {
        metrics[id] = median(reports.map((r) => metricValue(r, id)));
      }
    }
    return {
      page: first.page,
      formFactor: first.formFactor,
      runs: group.length,
      scores,
      metrics,
      failedAudits: [...new Set(reports.flatMap(failedAudits))].sort(),
    };
  });
}

/** 判定するカテゴリを測っていて、その中央値が 100 を切った行 */
export function failingRows(rows: readonly Row[]): Row[] {
  return rows.filter((row) => GATED.some((c) => (row.scores[c] ?? 100) < 100));
}

function formatMetric(id: MetricId, value: number): string {
  return id === "cumulative-layout-shift" ? value.toFixed(3) : `${(value / 1000).toFixed(1)} s`;
}

const CATEGORY_LABELS: Record<Category, string> = {
  performance: "Perf",
  accessibility: "A11y",
  "best-practices": "BP",
  seo: "SEO",
};

/** ジョブの概要（GitHub の Markdown）に出す表。見出しは測り方ごとに呼ぶ側が決める */
export function toMarkdown(rows: readonly Row[], heading: string): string {
  const categories = CATEGORIES.filter((c) => rows.some((row) => row.scores[c] !== undefined));
  const metrics = METRICS.filter(([id]) => rows.some((row) => row.metrics[id] !== undefined));
  const header = [
    "ページ",
    "端末",
    ...categories.map((c) => CATEGORY_LABELS[c]),
    ...metrics.map(([, label]) => label),
  ];
  const table = [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => {
      const cells = [
        row.page,
        row.formFactor === "mobile" ? "モバイル" : "デスクトップ",
        ...categories.map((c) => String(row.scores[c] ?? "—")),
        ...metrics.map(([id]) => {
          const value = row.metrics[id];
          return value === undefined ? "—" : formatMetric(id, value);
        }),
      ];
      return `| ${cells.join(" | ")} |`;
    }),
  ];

  const lines = [`## ${heading}`, ""];
  const failing = failingRows(rows);
  if (failing.length > 0) {
    lines.push("### 100 を切ったカテゴリ（A11y・BP・SEO）", "");
    for (const row of failing) {
      lines.push(`- ${row.page}（${row.formFactor}）`);
      lines.push(...row.failedAudits.map((audit) => `  - ${audit}`));
    }
    lines.push("");
  }
  if (rows.length > FOLD_ROWS) {
    // GitHub は <summary> の後に空行が無いと、中の表を Markdown として読まない
    lines.push(
      `<details><summary>全 ${String(rows.length)} 行の結果</summary>`,
      "",
      ...table,
      "",
      "</details>",
    );
  } else {
    lines.push(...table);
  }
  return `${lines.join("\n")}\n`;
}
