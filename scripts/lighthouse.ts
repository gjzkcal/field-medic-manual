// 使い方（どちらも、最後に出力先のフォルダを渡せる。既定は lighthouse-results）:
//   pnpm build:web の後に pnpm lighthouse:web
//     合否。Web 版のビルド（dist-web）を vite preview で配り、ビルドにある全ページ（画面と原稿ごと）を
//     モバイルとデスクトップで A11y・BP・SEO だけ 1 回ずつ測る。どれかが 100 を切ったら失敗する。
//     この 3 つはページの中身で決まりぶれないので、回数ではなく測るページの広さで漏れを防ぐ。
//   pnpm lighthouse:web --url https://gjzkcal.github.io/field-medic-manual/
//     性能。公開した Web 版の代表ページを、モバイルとデスクトップで Performance だけ 5 回ずつ測り、中央値を記録する。
//     利用者が開くもの（リリースの版と Pages の配信）の数字にするため、preview ではなく本番を測る。
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
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  FORM_FACTORS,
  failingRows,
  pagesFromBuild,
  parseReport,
  summarize,
  toMarkdown,
  type FormFactor,
  type Run,
} from "./lib/lighthouse.ts";

// 手元と PageSpeed Insights の点数と比べられるよう、版を固定する（Renovate が .github/renovate.json5 の正規表現で追う）
const LIGHTHOUSE = "lighthouse@13.5.0";
const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist-web");
// vite.config.ts の WEB_BASE と同じ
const BASE = "/field-medic-manual/";
// fetch と Chrome が接続を止める番号（4190 など、fetch の仕様の bad port）を避ける
const PREVIEW_PORT = 4176;
// 性能を測るページ。一覧・クイック表と、いちばん長い原稿（本文の描画がいちばん重い）
const PERFORMANCE_PAGES = ["library", "quickref", "doc/cardiac-arrest-system"];
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
  options: { url: { type: "string" } },
  allowPositionals: true,
});
const outDir = join(ROOT, positionals[0] ?? "lighthouse-results");
const production = options.url;
// pnpm の実体（pnpm.cjs）を node で直接動かす。Windows の pnpm.cmd はシェルを通さないと起動できず、
// シェルを通すと引数の扱いが OS で変わるため
const pnpm = process.env["npm_execpath"] ?? fail("pnpm lighthouse:web から実行してください");

const env = { ...process.env };
if (process.platform === "win32" && env["CHROME_PATH"] === undefined && existsSync(EDGE)) {
  env["CHROME_PATH"] = EDGE;
}
// GitHub の ubuntu のランナーは、Chrome のサンドボックスに要る名前空間を使えない。測るのは自分のサイトだけ
const chromeFlags = process.platform === "linux" ? "--headless=new --no-sandbox" : "--headless=new";

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
    await new Promise((resolve) => setTimeout(resolve, 500));
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

interface Plan {
  /** 末尾が / の URL。ページのパスを足して開く */
  base: string;
  pages: string[];
  runs: number;
  categories: string;
  concurrency: number;
  heading: (version: string) => string;
}

function plan(): Plan {
  if (production !== undefined) {
    return {
      base: production.endsWith("/") ? production : `${production}/`,
      pages: PERFORMANCE_PAGES,
      runs: PERFORMANCE_RUNS,
      categories: "performance",
      concurrency: 1,
      heading: (version) =>
        `Lighthouse ${version}: 本番の Performance（各 ${String(PERFORMANCE_RUNS)} 回の中央値）`,
    };
  }
  if (!existsSync(join(DIST, "index.html"))) {
    fail("dist-web がありません。先に pnpm build:web を実行してください");
  }
  const pages = pagesFromBuild(
    readdirSync(DIST, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html")),
  );
  return {
    base: `http://localhost:${String(PREVIEW_PORT)}${BASE}`,
    pages,
    runs: 1,
    categories: "accessibility,best-practices,seo",
    concurrency: GATE_CONCURRENCY,
    heading: (version) =>
      `Lighthouse ${version}: A11y・BP・SEO（全 ${String(pages.length)} ページ）`,
  };
}

const { base, pages, runs: runsPerPage, categories, concurrency, heading } = plan();

// ブラウザのデバッグのポート。毎回別にして、時間切れで残ったブラウザや並べて走らせた回とぶつからないようにする
// （Windows の Edge は、ポートを指定しないと Lighthouse がデバッグのポートを見つけられない）
let debugPort = 9300;

async function measure(page: string, formFactor: FormFactor, name: string): Promise<Run> {
  const outputPath = join(outDir, name);
  // ブラウザの起動の失敗などはまれに起きるので、1 回だけやり直す
  for (let attempt = 1; attempt <= 2; attempt++) {
    const code = await run(
      process.execPath,
      [
        pnpm,
        "dlx",
        LIGHTHOUSE,
        `${base}${page}`,
        ...(formFactor === "desktop" ? ["--preset=desktop"] : []),
        `--only-categories=${categories}`,
        `--chrome-flags=${chromeFlags}`,
        `--port=${String(debugPort++)}`,
        "--output=json",
        "--output=html",
        `--output-path=${outputPath}`,
        "--quiet",
      ],
      RUN_TIMEOUT_MS,
    );
    const json = `${outputPath}.report.json`;
    if (code === 0 && existsSync(json)) {
      process.stdout.write(`${name}: 完了\n`);
      return { page: `/${page}`, formFactor, report: parseReport(readFileSync(json, "utf8")) };
    }
    process.stdout.write(
      `${name}: 失敗（${code === null ? "時間切れ" : `終了コード ${String(code)}`}）\n`,
    );
  }
  throw new Error(`${name} を測れませんでした`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const preview =
  production === undefined
    ? spawn(
        process.execPath,
        [
          join(ROOT, "node_modules", "vite", "bin", "vite.js"),
          "preview",
          "--mode",
          "web",
          "--port",
          String(PREVIEW_PORT),
          "--strictPort",
        ],
        { cwd: ROOT, stdio: "ignore" },
      )
    : undefined;

async function measureAll(): Promise<Run[]> {
  await waitForServer(`${base}library`);
  // pnpm dlx は Lighthouse を初めて使う（キャッシュが切れた）ときに入れ直す。並べた回が同時に入れると
  // pnpm の保存先を取り合って失敗する（Windows で EBUSY）ので、先に 1 回だけ入れておく
  if ((await run(process.execPath, [pnpm, "dlx", LIGHTHOUSE, "--version"], RUN_TIMEOUT_MS)) !== 0) {
    throw new Error(`${LIGHTHOUSE} を用意できませんでした`);
  }
  const tasks = pages.flatMap((page) =>
    FORM_FACTORS.flatMap((formFactor) =>
      Array.from({ length: runsPerPage }, (_, i) => {
        const name = `${page.replaceAll("/", "_")}_${formFactor}_${String(i + 1)}`;
        return () => measure(page, formFactor, name);
      }),
    ),
  );
  process.stdout.write(
    `${base} の ${String(pages.length)} ページを ${String(tasks.length)} 回測ります\n`,
  );
  return runPool(tasks, concurrency);
}

// fail は process.exit で終わり finally を飛ばすので、preview を止めてから失敗にする
const results = await measureAll()
  .finally(() => preview?.kill())
  .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

const rows = summarize(results);
const markdown = toMarkdown(rows, heading(results[0]?.report.lighthouseVersion ?? LIGHTHOUSE));
writeFileSync(join(outDir, "summary.md"), markdown);
process.stdout.write(`\n${markdown}`);
const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile !== undefined) {
  appendFileSync(summaryFile, markdown);
}
if (failingRows(rows).length > 0) {
  fail("A11y・BP・SEO のどれかが 100 を切りました（上の一覧）");
}
