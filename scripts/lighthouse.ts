// 使い方（どちらも、最後に出力先のフォルダを渡せる。既定は lighthouse-results）:
//   pnpm build:web の後に pnpm lighthouse:web
//     合否。Web 版のビルド（dist-web）を vite preview で配り、ビルドにある全ページ（画面と原稿ごと）を
//     モバイルとデスクトップで A11y・BP・SEO だけ 1 回ずつ測る。どれかが 100 を切ったら失敗する。
//     この 3 つはページの中身で決まりぶれないので、回数ではなく測るページの広さで漏れを防ぐ。
//     --shard 2/3 を付けると、全ページを 3 つに分けた 2 番目だけを測る（CI で複数のジョブに分けて時間を縮めるため）。
//   pnpm lighthouse:web --url https://gjzkcal.github.io/field-medic-manual/
//     性能。公開した Web 版の全画面と重い原稿を、モバイルとデスクトップで Performance だけ 5 回ずつ測り、中央値を記録する。
//     利用者が開くもの（リリースの版と Pages の配信）の数字にするため、記録に残すのは本番の数字にする。
//   pnpm build:web の後に pnpm lighthouse:web --performance
//     性能を、同じページ・同じ回数で vite preview に対して測る。本番と配信が違うので記録には使わず、
//     公開する前に、変更の前後を同じ条件で比べるために使う。
//     --compare <別のビルドの dist-web> を足すと、そのビルドと今のビルドを同じページで交互に測り、「前 → 後（差）」の表を出す
//     （.github/workflows/lighthouse-compare.yml が、ブランチと main を同じランナーで比べるのに使う）。
//     --pages library,doc/morphine で測るページを、--form-factor mobile で端末を絞れる（--url でも使える）。
// CI（.github/workflows/lighthouse.yml と pages.yml）と手元で同じ測り方にする。
// ブラウザは Chrome（CHROME_PATH）。Windows で Chrome が無ければ Edge を使う。

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { launchHeadlessBrowser, type HeadlessBrowser } from "./lib/headless-browser.ts";
import {
  failingRows,
  pagesFromBuild,
  PERFORMANCE_PAGES,
  parseReport,
  parseShard,
  selectFormFactors,
  selectPages,
  shardPages,
  summarize,
  toComparisonMarkdown,
  toMarkdown,
  type FormFactor,
  type Run,
  type Shard,
} from "./lib/lighthouse.ts";

// 手元と PageSpeed Insights の点数と比べられるよう、版を固定する（Renovate が .github/renovate.json5 の正規表現で追う）
const LIGHTHOUSE = "lighthouse@13.6.0";
const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist-web");
// vite.config.ts の WEB_BASE と同じ
const BASE = "/field-medic-manual/";
// fetch と Chrome が接続を止める番号（4190 など、fetch の仕様の bad port）を避ける
const PREVIEW_PORT = 4176;
// --compare で比べる相手のビルドを配るポート
const COMPARE_PORT = 4177;
// Lighthouse の文書が、ぶれを抑えるのに勧める回数
const PERFORMANCE_RUNS = 5;
// 合否は点数が計測の速さに左右されないので、並べて走らせて時間を縮める。
// 性能は同時に走らせると互いの CPU を奪って数字が悪くなるので、1 本ずつにする
const GATE_CONCURRENCY = 3;
const RUN_TIMEOUT_MS = 180_000;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const { values: options, positionals } = parseArgs({
  options: {
    url: { type: "string" },
    performance: { type: "boolean" },
    compare: { type: "string" },
    pages: { type: "string" },
    "form-factor": { type: "string" },
    shard: { type: "string" },
  },
  allowPositionals: true,
});
const outDir = join(ROOT, positionals[0] ?? "lighthouse-results");
const production = options.url;
const measuresPerformance = production !== undefined || options.performance === true;
// 性能は 1 本ずつ測る前提なので、分けて同時に測ると数字が悪くなる
if (measuresPerformance && options.shard !== undefined) {
  fail("--shard は --url・--performance と一緒に使えません");
}
// 合否は全ページ・両方の端末を測ると決めている。絞れるのは性能だけにして、絞ったまま合格にしてしまうのを防ぐ
if (!measuresPerformance && (options.pages !== undefined || options["form-factor"] !== undefined)) {
  fail("--pages と --form-factor は --url・--performance と一緒に使ってください");
}
if (options.compare !== undefined && (production !== undefined || options.performance !== true)) {
  fail("--compare は --performance と一緒に使い、--url とは使えません");
}
// pnpm はリポジトリの直下で動かすので、相対パスはそこから
const compareDist = options.compare === undefined ? undefined : resolvePath(ROOT, options.compare);
function orFail<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
const shard: Shard | undefined = orFail(() =>
  options.shard === undefined ? undefined : parseShard(options.shard),
);
const formFactors = orFail(() => selectFormFactors(options["form-factor"]));
// pnpm の実体（pnpm.cjs）を node で直接動かす。Windows の pnpm.cmd はシェルを通さないと起動できず、
// シェルを通すと引数の扱いが OS で変わるため
const pnpm = process.env["npm_execpath"] ?? fail("pnpm lighthouse:web から実行してください");

const env = { ...process.env };
if (process.platform === "win32" && env["CHROME_PATH"] === undefined && existsSync(EDGE)) {
  env["CHROME_PATH"] = EDGE;
}
// GitHub の ubuntu のランナーは、Chrome のサンドボックスに要る名前空間を使えない。測るのは自分のサイトだけ
const chromeFlags = process.platform === "linux" ? "--headless=new --no-sandbox" : "--headless=new";
// Windows では、Lighthouse に起動させたブラウザのウィンドウの項目が Alt+Tab に残るので、こちらで起動して閉じさせる
// （scripts/lib/headless-browser.ts）。CI（Linux）は残る先が無く、記録してきた本番の数字と測り方を変えないため、今までどおり
const ownBrowser = process.platform === "win32" ? env["CHROME_PATH"] : undefined;

/** 子プロセスを動かし、終了コードを返す。時間を過ぎたら止めて null */
function run(command: string, args: string[], timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "ignore", "inherit"] });
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // まだ起動していない
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  throw new Error(`サイトに接続できませんでした: ${url}`);
}

/** 仕事を最大 concurrency 本ずつ走らせ、渡した順に結果を返す */
async function runPool<T>(tasks: readonly (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < tasks.length; i = next++) {
      const task = tasks[i];
      if (task !== undefined) {
        results[i] = await task();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/** 測る先。比べるときは 2 つ（前のビルドと今のビルド）、それ以外は 1 つ */
interface Target {
  /** レポートのファイル名の先頭に付ける。1 つだけなら空 */
  prefix: string;
  /** 末尾が / の URL。ページのパスを足して開く */
  base: string;
  /** vite preview で配るビルド。本番を測るときは無い */
  dist?: { dir: string; port: number };
}

interface Plan {
  targets: Target[];
  pages: string[];
  formFactors: readonly FormFactor[];
  runs: number;
  categories: string;
  concurrency: number;
  heading: (version: string) => string;
}

function builtPages(dist: string): string[] {
  if (!existsSync(join(dist, "index.html"))) {
    fail(`${dist} に Web 版のビルドがありません。先に pnpm build:web を実行してください`);
  }
  return pagesFromBuild(
    readdirSync(dist, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html")),
  );
}

function local(port: number): string {
  return `http://localhost:${String(port)}${BASE}`;
}

function performancePlan(targets: Target[], pages: string[], target: string): Plan {
  return {
    targets,
    pages,
    formFactors,
    runs: PERFORMANCE_RUNS,
    categories: "performance",
    concurrency: 1,
    heading: (version) =>
      `Lighthouse ${version}: ${target}の Performance（各 ${String(PERFORMANCE_RUNS)} 回の中央値）`,
  };
}

function plan(): Plan {
  if (production !== undefined) {
    // 本番は無い URL に 404.html（どの URL でも起動する画面）を返すので、ページがあるかはここでは確かめられない
    const pages = orFail(() => selectPages(options.pages, PERFORMANCE_PAGES));
    const base = production.endsWith("/") ? production : `${production}/`;
    return performancePlan([{ prefix: "", base }], pages, "本番");
  }
  const allPages = builtPages(DIST);
  const head = { dir: DIST, port: PREVIEW_PORT };
  if (measuresPerformance) {
    const pages = orFail(() => selectPages(options.pages, PERFORMANCE_PAGES, allPages));
    if (compareDist === undefined) {
      return performancePlan(
        [{ prefix: "", base: local(head.port), dist: head }],
        pages,
        "preview ",
      );
    }
    // 前のビルドに無いページ（後から足した画面・原稿）は比べられないので、両方にあるページだけを測る
    const before = builtPages(compareDist);
    const skipped = pages.filter((page) => !before.includes(page));
    if (skipped.length > 0) {
      process.stdout.write(`比べる相手のビルドに無いので測りません: ${skipped.join("、")}\n`);
    }
    const shared = pages.filter((page) => before.includes(page));
    if (shared.length === 0) {
      fail("両方のビルドにあるページがありません");
    }
    return performancePlan(
      [
        {
          prefix: "before_",
          base: local(COMPARE_PORT),
          dist: { dir: compareDist, port: COMPARE_PORT },
        },
        { prefix: "after_", base: local(head.port), dist: head },
      ],
      shared,
      "前 → 後",
    );
  }
  const pages = shard === undefined ? allPages : shardPages(allPages, shard);
  const scope =
    shard === undefined
      ? `全 ${String(allPages.length)} ページ`
      : `全 ${String(allPages.length)} ページのうち分担 ${String(shard.index)}/${String(shard.total)} の ${String(pages.length)} ページ`;
  return {
    targets: [{ prefix: "", base: local(head.port), dist: head }],
    pages,
    formFactors,
    runs: 1,
    categories: "accessibility,best-practices,seo",
    concurrency: GATE_CONCURRENCY,
    heading: (version) => `Lighthouse ${version}: A11y・BP・SEO（${scope}）`,
  };
}

const planned = plan();
const { targets, pages, runs: runsPerPage, categories, concurrency, heading } = planned;

// ブラウザのデバッグのポート。毎回別にして、時間切れで残ったブラウザや並べて走らせた回とぶつからないようにする
// （Windows の Edge は、ポートを指定しないと Lighthouse がデバッグのポートを見つけられない）
let debugPort = 9300;

/** Lighthouse を 1 回動かし、終了コードを返す。時間切れと、ブラウザを起動できなかったときは null */
async function runLighthouse(
  url: string,
  formFactor: FormFactor,
  outputPath: string,
): Promise<number | null> {
  const port = debugPort++;
  let browser: HeadlessBrowser | undefined;
  try {
    // 先にポートへブラウザを用意しておくと、Lighthouse は自分で起動せずにそれへ接続する
    browser = ownBrowser === undefined ? undefined : await launchHeadlessBrowser(ownBrowser, port);
    return await run(
      process.execPath,
      [
        pnpm,
        "dlx",
        LIGHTHOUSE,
        url,
        ...(formFactor === "desktop" ? ["--preset=desktop"] : []),
        `--only-categories=${categories}`,
        ...(browser === undefined ? [`--chrome-flags=${chromeFlags}`] : []),
        `--port=${String(port)}`,
        "--output=json",
        "--output=html",
        `--output-path=${outputPath}`,
        "--quiet",
      ],
      RUN_TIMEOUT_MS,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  } finally {
    await browser?.close();
  }
}

async function measure(
  target: Target,
  page: string,
  formFactor: FormFactor,
  name: string,
): Promise<Run> {
  const outputPath = join(outDir, name);
  // ブラウザの起動の失敗などはまれに起きるので、1 回だけやり直す
  for (let attempt = 1; attempt <= 2; attempt++) {
    const code = await runLighthouse(`${target.base}${page}`, formFactor, outputPath);
    const json = `${outputPath}.report.json`;
    if (code === 0 && existsSync(json)) {
      process.stdout.write(`${name}: 完了\n`);
      return { page: `/${page}`, formFactor, report: parseReport(readFileSync(json, "utf8")) };
    }
    process.stdout.write(
      `${name}: 失敗（${code === null ? "時間切れか、ブラウザを起動できない" : `終了コード ${String(code)}`}）\n`,
    );
  }
  throw new Error(`${name} を測れませんでした`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const previews = targets.flatMap(({ dist }) =>
  dist === undefined
    ? []
    : [
        spawn(
          process.execPath,
          [
            join(ROOT, "node_modules", "vite", "bin", "vite.js"),
            "preview",
            "--mode",
            "web",
            "--outDir",
            dist.dir,
            "--port",
            String(dist.port),
            "--strictPort",
          ],
          { cwd: ROOT, stdio: "ignore" },
        ),
      ],
);

interface Measured {
  target: Target;
  run: Run;
}

async function measureAll(): Promise<Measured[]> {
  for (const target of targets) {
    await waitForServer(`${target.base}library`);
  }
  // pnpm dlx は Lighthouse を初めて使う（キャッシュが切れた）ときに入れ直す。並べた回が同時に入れると
  // pnpm の保存先を取り合って失敗する（Windows で EBUSY）ので、先に 1 回だけ入れておく
  if ((await run(process.execPath, [pnpm, "dlx", LIGHTHOUSE, "--version"], RUN_TIMEOUT_MS)) !== 0) {
    throw new Error(`${LIGHTHOUSE} を用意できませんでした`);
  }
  // 比べるときは、同じ回を前・後の順に続けて測る。まとめて前、まとめて後にすると、
  // 測っている間に機械の速さが変わった分（共有のランナーの混み具合、手元の熱）が、そのまま差に見える
  const tasks = pages.flatMap((page) =>
    planned.formFactors.flatMap((formFactor) =>
      Array.from({ length: runsPerPage }, (_, i) =>
        targets.map((target) => {
          const name = `${target.prefix}${page.replaceAll("/", "_")}_${formFactor}_${String(i + 1)}`;
          return async (): Promise<Measured> => ({
            target,
            run: await measure(target, page, formFactor, name),
          });
        }),
      ).flat(),
    ),
  );
  process.stdout.write(
    `${targets.map((target) => target.base).join(" と ")} の ${String(pages.length)} ページを ${String(tasks.length)} 回測ります\n`,
  );
  return runPool(tasks, concurrency);
}

// fail は process.exit で終わり finally を飛ばすので、preview を止めてから失敗にする
const results = await measureAll()
  .finally(() => {
    for (const preview of previews) {
      preview.kill();
    }
  })
  .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

const title = heading(results[0]?.run.report.lighthouseVersion ?? LIGHTHOUSE);
const [first, second] = targets.map((target) =>
  summarize(results.filter((r) => r.target === target).map((r) => r.run)),
);
const rows = first ?? [];
const markdown =
  second === undefined ? toMarkdown(rows, title) : toComparisonMarkdown(rows, second, title);
writeFileSync(join(outDir, "summary.md"), markdown);
process.stdout.write(`\n${markdown}`);
const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile !== undefined) {
  appendFileSync(summaryFile, markdown);
}
if (failingRows(rows).length > 0) {
  fail("A11y・BP・SEO のどれかが 100 を切りました（上の一覧）");
}
