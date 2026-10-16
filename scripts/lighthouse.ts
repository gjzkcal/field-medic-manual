// 使い方: pnpm build:web の後に pnpm lighthouse:web [出力先のフォルダ（既定は lighthouse-results）]
// Web 版のビルド（dist-web）を vite preview で配り、Lighthouse で /library・本文・クイック表を
// モバイルとデスクトップで 3 回ずつ測る。中央値の表を出し、A11y・BP・SEO が 100 を切ったら失敗する。
// CI（.github/workflows/lighthouse.yml）と手元で同じ測り方にする。
// ブラウザは Chrome（CHROME_PATH）。Windows で Chrome が無ければ Edge を使う。

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";

import {
  FORM_FACTORS,
  failingRows,
  parseReport,
  summarize,
  toMarkdown,
  type FormFactor,
  type Run,
} from "./lib/lighthouse.ts";

// 手元と PageSpeed Insights の点数と比べられるよう、版を固定する（Renovate が .github/renovate.json5 の正規表現で追う）
const LIGHTHOUSE = "lighthouse@13.5.0";
const ROOT = join(import.meta.dirname, "..");
// vite.config.ts の WEB_BASE と同じ
const BASE = "/field-medic-manual/";
// fetch と Chrome が接続を止める番号（4190 など、fetch の仕様の bad port）を避ける
const PREVIEW_PORT = 4176;
const PAGES = ["library", "doc/bleeding-system", "quickref"];
const RUNS = 3;
const RUN_TIMEOUT_MS = 180_000;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const outDir = join(ROOT, process.argv[2] ?? "lighthouse-results");
if (!existsSync(join(ROOT, "dist-web", "index.html"))) {
  fail("dist-web がありません。先に pnpm build:web を実行してください");
}
// pnpm の実体（pnpm.cjs）を node で直接動かす。Windows の pnpm.cmd はシェルを通さないと起動できず、
// シェルを通すと引数の扱いが OS で変わるため
const pnpm = process.env["npm_execpath"] ?? fail("pnpm lighthouse:web から実行してください");

const env = { ...process.env };
if (process.platform === "win32" && env["CHROME_PATH"] === undefined && existsSync(EDGE)) {
  env["CHROME_PATH"] = EDGE;
}
// GitHub の ubuntu のランナーは、Chrome のサンドボックスに要る名前空間を使えない。測るのは手元のビルドだけ
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
  fail(`プレビューが起動しませんでした: ${url}`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const preview = spawn(
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
);
const origin = `http://localhost:${String(PREVIEW_PORT)}`;
// ブラウザのデバッグのポート。毎回別にして、時間切れで残ったブラウザがふさいでも次の回を測れるようにする
// （Windows の Edge は、ポートを指定しないと Lighthouse がデバッグのポートを見つけられない）
let debugPort = 9300;
const runs: Run[] = [];
try {
  await waitForServer(`${origin}${BASE}library`);
  for (const page of PAGES) {
    for (const formFactor of FORM_FACTORS) {
      for (let i = 1; i <= RUNS; i++) {
        const name = `${page.replaceAll("/", "_")}_${formFactor}_${String(i)}`;
        runs.push({ page: `/${page}`, formFactor, report: await measure(page, formFactor, name) });
      }
    }
  }
} finally {
  preview.kill();
}

async function measure(page: string, formFactor: FormFactor, name: string): Promise<Run["report"]> {
  const outputPath = join(outDir, name);
  // ブラウザの起動の失敗などはまれに起きるので、1 回だけやり直す
  for (let attempt = 1; attempt <= 2; attempt++) {
    const code = await run(
      process.execPath,
      [
        pnpm,
        "dlx",
        LIGHTHOUSE,
        `${origin}${BASE}${page}`,
        ...(formFactor === "desktop" ? ["--preset=desktop"] : []),
        "--only-categories=performance,accessibility,best-practices,seo",
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
      return parseReport(readFileSync(json, "utf8"));
    }
    process.stdout.write(
      `${name}: 失敗（${code === null ? "時間切れ" : `終了コード ${String(code)}`}）\n`,
    );
  }
  return fail(`${name} を測れませんでした`);
}

const rows = summarize(runs);
const markdown = toMarkdown(rows, runs[0]?.report.lighthouseVersion ?? LIGHTHOUSE);
writeFileSync(join(outDir, "summary.md"), markdown);
process.stdout.write(`\n${markdown}`);
const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile !== undefined) {
  appendFileSync(summaryFile, markdown);
}
if (failingRows(rows).length > 0) {
  fail("A11y・BP・SEO のどれかが 100 を切りました（上の一覧）");
}
