import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  failingRows,
  median,
  METRICS,
  pagesFromBuild,
  PERFORMANCE_PAGES,
  parseReport,
  parseShard,
  shardPages,
  summarize,
  toMarkdown,
  type Report,
  type Run,
} from "./lighthouse.ts";

const category = (score: number, auditId: string): Report["categories"][string] => ({
  score,
  auditRefs: [{ id: auditId, weight: 1 }],
});

/** 判定するカテゴリには監査を 1 つずつ持たせ、その点数をカテゴリの点数にする */
function report(scores: { performance: number; accessibility: number }, lcp = 3000): Report {
  return parseReport(
    JSON.stringify({
      lighthouseVersion: "13.5.0",
      categories: {
        performance: category(scores.performance / 100, "largest-contentful-paint"),
        accessibility: category(scores.accessibility / 100, "color-contrast"),
        "best-practices": category(1, "errors-in-console"),
        seo: category(1, "document-title"),
      },
      audits: {
        "first-contentful-paint": audit("first-contentful-paint", 1, 2000),
        "largest-contentful-paint": audit("largest-contentful-paint", 0.5, lcp),
        "total-blocking-time": audit("total-blocking-time", 0.5, 300),
        "cumulative-layout-shift": audit("cumulative-layout-shift", 1, 0),
        "color-contrast": audit("color-contrast", scores.accessibility === 100 ? 1 : 0),
        "errors-in-console": audit("errors-in-console", 1),
        "document-title": audit("document-title", 1),
      },
    }),
  );
}

/** 合否のモードと同じく、A11y・BP・SEO だけを測ったレポート（Performance の指標も無い） */
function gateReport(accessibility: number): Report {
  const full = report({ performance: 100, accessibility });
  const metricIds = new Set<string>(METRICS.map(([id]) => id));
  return {
    ...full,
    categories: Object.fromEntries(
      Object.entries(full.categories).filter(([id]) => id !== "performance"),
    ),
    audits: Object.fromEntries(Object.entries(full.audits).filter(([id]) => !metricIds.has(id))),
  };
}

function audit(id: string, score: number, numericValue?: number): Report["audits"][string] {
  return {
    id,
    title: `${id} の題名`,
    score,
    scoreDisplayMode: "binary",
    ...(numericValue === undefined ? {} : { numericValue }),
  };
}

function runs(page: string, reports: Report[]): Run[] {
  return reports.map((r) => ({ page, formFactor: "mobile", report: r }));
}

describe("median", () => {
  it("奇数個なら真ん中、偶数個なら真ん中 2 つの平均", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("pagesFromBuild", () => {
  it("index.html と 404.html を除き、画面のルートを先に、原稿をその後に並べる", () => {
    expect(
      pagesFromBuild([
        // Windows の readdirSync は区切りが \ になる
        "doc\\pain.html",
        "404.html",
        "quickref.html",
        "index.html",
        "doc/airway.html",
        "library.html",
      ]),
    ).toStrictEqual(["library", "quickref", "doc/airway", "doc/pain"]);
  });
});

describe("PERFORMANCE_PAGES", () => {
  const root = join(import.meta.dirname, "..", "..");
  const router = readFileSync(join(root, "src", "web", "router.tsx"), "utf8");

  // 本番は無い URL に 404.html（どの URL でも起動する同じ画面）を返すので、原稿やフローの名前を変えると、
  // 計測は失敗せずに、黙って別の画面の数字を記録する
  function exists(page: string): boolean {
    const [kind, id] = page.split("/");
    if (id === undefined) {
      return router.includes(`path: "${page}"`);
    }
    if (kind === "doc") {
      return existsSync(join(root, "content", "manuals", `${id}.md`));
    }
    return kind === "triage" && existsSync(join(root, "content", "flows", `${id}.flow.yaml`));
  }

  it.each(PERFORMANCE_PAGES)("%s は、Web 版にある画面・原稿・フロー", (page) => {
    expect(exists(page)).toBe(true);
  });
});

describe("parseShard", () => {
  it("i/n を 1 始まりの番号と分担の数にする", () => {
    expect(parseShard("2/3")).toStrictEqual({ index: 2, total: 3 });
    expect(parseShard("1/1")).toStrictEqual({ index: 1, total: 1 });
  });

  it.each(["0/3", "4/3", "1/0", "1", "a/3", "1.5/3", "-1/3", "1/3/5", ""])(
    "%j は例外にする",
    (spec) => {
      expect(() => parseShard(spec)).toThrow("--shard");
    },
  );
});

describe("shardPages", () => {
  const pages = ["library", "quickref", "doc/a", "doc/b", "doc/c", "doc/d", "doc/e"];

  it("順に配り、どのページもちょうど 1 つの分担に入る", () => {
    const shards = [1, 2, 3].map((index) => shardPages(pages, { index, total: 3 }));
    expect(shards).toStrictEqual([
      ["library", "doc/b", "doc/e"],
      ["quickref", "doc/c"],
      ["doc/a", "doc/d"],
    ]);
    expect(shards.flat().toSorted()).toStrictEqual(pages.toSorted());
  });

  it("分担が 1 つなら全ページ", () => {
    expect(shardPages(pages, { index: 1, total: 1 })).toStrictEqual(pages);
  });
});

describe("summarize", () => {
  it("ページ × 端末ごとに、点数と指標の中央値をとる", () => {
    const [row] = summarize(
      runs("/library", [
        report({ performance: 70, accessibility: 100 }, 3000),
        report({ performance: 90, accessibility: 100 }, 5000),
        report({ performance: 80, accessibility: 100 }, 4000),
      ]),
    );
    expect(row?.runs).toBe(3);
    expect(row?.scores.performance).toBe(80);
    expect(row?.metrics["largest-contentful-paint"]).toBe(4000);
    expect(row?.failedAudits).toStrictEqual([]);
  });

  it("Performance が低くても失敗にせず、A11y・BP・SEO が 100 を切ったら失敗にする", () => {
    const rows = summarize([
      ...runs("/slow", [report({ performance: 30, accessibility: 100 })]),
      ...runs("/contrast", [report({ performance: 100, accessibility: 95 })]),
    ]);
    expect(failingRows(rows).map((r) => r.page)).toStrictEqual(["/contrast"]);
    expect(rows[1]?.failedAudits).toStrictEqual([
      "accessibility: color-contrast（color-contrast の題名）",
    ]);
  });

  it("重みが 0 の監査は、落ちていても一覧に出さない", () => {
    const r = report({ performance: 100, accessibility: 100 });
    const withSourceMaps: Report = {
      ...r,
      categories: {
        ...r.categories,
        "best-practices": {
          score: 1,
          auditRefs: [
            { id: "errors-in-console", weight: 1 },
            { id: "valid-source-maps", weight: 0 },
          ],
        },
      },
      audits: { ...r.audits, "valid-source-maps": audit("valid-source-maps", 0) },
    };
    const [row] = summarize(runs("/x", [withSourceMaps]));
    expect(row?.failedAudits).toStrictEqual([]);
  });

  it("カテゴリの点数が null（測れなかった）なら 0 にする", () => {
    const r = report({ performance: 100, accessibility: 100 });
    const broken: Report = {
      ...r,
      categories: { ...r.categories, seo: { score: null, auditRefs: [] } },
    };
    const [row] = summarize(runs("/x", [broken]));
    expect(row?.scores.seo).toBe(0);
  });

  it("測っていないカテゴリと指標は持たず、判定にも使わない", () => {
    const [row] = summarize(runs("/library", [gateReport(100)]));
    expect(row?.scores).toStrictEqual({ accessibility: 100, "best-practices": 100, seo: 100 });
    expect(row?.metrics).toStrictEqual({});
    expect(failingRows(row === undefined ? [] : [row])).toStrictEqual([]);
  });

  it("同じページの回でカテゴリがそろっていなければ例外にする", () => {
    expect(() =>
      summarize(
        runs("/library", [report({ performance: 90, accessibility: 100 }), gateReport(100)]),
      ),
    ).toThrow("performance");
  });
});

describe("toMarkdown", () => {
  it("全カテゴリの列と、100 を切った監査の一覧を出す", () => {
    const markdown = toMarkdown(
      summarize(runs("/contrast", [report({ performance: 75, accessibility: 95 })])),
      "Lighthouse 13.5.0",
    );
    expect(markdown).toContain("## Lighthouse 13.5.0");
    expect(markdown).toContain(
      "| /contrast | モバイル | 75 | 95 | 100 | 100 | 2.0 s | 3.0 s | 0.3 s | 0.000 |",
    );
    expect(markdown).toContain("  - accessibility: color-contrast（color-contrast の題名）");
  });

  it("転送量を測っていれば、KB の列を足す", () => {
    const r = report({ performance: 75, accessibility: 100 });
    const withBytes: Report = {
      ...r,
      audits: { ...r.audits, "total-byte-weight": audit("total-byte-weight", 1, 555 * 1024) },
    };
    const markdown = toMarkdown(summarize(runs("/library", [withBytes])), "Performance");
    expect(markdown).toContain("| FCP | LCP | TBT | CLS | 転送量 |");
    expect(markdown).toContain("| 2.0 s | 3.0 s | 0.3 s | 0.000 | 555 KB |");
  });

  it("測ったカテゴリの列だけを出し、行が多ければ表を畳んで失敗の一覧を先に出す", () => {
    const pages = Array.from({ length: 13 }, (_, i) => `/doc/p${String(i)}`);
    const markdown = toMarkdown(
      summarize(pages.flatMap((page, i) => runs(page, [gateReport(i === 12 ? 90 : 100)]))),
      "A11y",
    );
    expect(markdown).toContain("| ページ | 端末 | A11y | BP | SEO |");
    expect(markdown).toContain("| /doc/p0 | モバイル | 100 | 100 | 100 |");
    expect(markdown).toContain("<details><summary>全 13 行の結果</summary>");
    expect(markdown.indexOf("- /doc/p12（mobile）")).toBeLessThan(markdown.indexOf("<details>"));
  });
});
