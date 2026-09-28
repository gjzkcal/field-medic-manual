// 使い方: pnpm licenses:generate（tauri.conf.json の beforeBuildCommand が、ビルドの前に毎回呼ぶ）
// 配布物に入る依存のライセンス文を集めて、ルートの THIRD_PARTY_LICENSES.txt に書く。
// - インストーラはこれをインストール先に同梱する（bundle.resources）。About の画面も同じファイルを読んで表示する。
// - ファイルはコミットしておく。tauri-build は resources のファイルが無いと `cargo test` や `tauri dev` まで失敗させるため。
//   依存を変えたときに、ライセンスの変化が差分で見える利点もある。
// 許可の一覧に無いライセンスがあれば失敗させる（scripts/lib/licenses.ts）。

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { z } from "zod";

import {
  cargoAboutSchema,
  groupCargoLicenses,
  groupNpmLicenses,
  isAllowedLicense,
  type NpmPackageLicense,
  pnpmLicensesSchema,
  renderNotice,
} from "./lib/licenses.ts";

const ROOT = join(import.meta.dirname, "..");
const OUTPUT = join(ROOT, "THIRD_PARTY_LICENSES.txt");

// devDependencies だが、ビルドで CSS に取り込まれて配布物に入るもの（`pnpm licenses --prod` には出ない）
const BUNDLED_DEV_PACKAGES = ["shadcn", "tailwindcss"];

// cargo-about の一覧に出ないが exe に静的リンクされるもの。本文は scripts/notices/ に原文を置く
// - Rust の標準ライブラリ: MIT OR Apache-2.0（MIT を選ぶ）。本文はツールチェーン同梱の licenses/MIT.txt
// - WebView2 の読み込み部（WebView2LoaderStatic.lib。webview2-com-sys が同梱）: crate は MIT だが、この部分は
//   Microsoft の WebView2 SDK のライセンス。本文は NuGet の Microsoft.Web.WebView2 1.0.3650.58 の LICENSE.txt
const OTHER_NOTICES = [
  {
    license: "MIT",
    packages: ["Rust standard library (std, core, alloc)"],
    file: "rust-std-mit.txt",
  },
  {
    license: "Microsoft WebView2 SDK license (BSD-3-Clause style)",
    packages: ["WebView2Loader (Microsoft.Web.WebView2 SDK, via webview2-com-sys)"],
    file: "webview2-sdk.txt",
  },
];

// cargo-about の JSON は数 MB になるので、既定の上限（1 MB）では足りない
const MAX_BUFFER = 256 * 1024 * 1024;

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

function licenseTexts(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

const packageJsonSchema = z.object({ name: z.string(), version: z.string(), license: z.string() });

function npmPackages(): NpmPackageLicense[] {
  const output = execSync("pnpm licenses list --prod --json", {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  const listed = Object.values(pnpmLicensesSchema.parse(JSON.parse(output))).flat();
  const packages = listed.flatMap((pkg) =>
    pkg.paths.map((path, index) => ({
      name: pkg.name,
      // pnpm は versions と paths を同じ順で返す
      version: pkg.versions[index] ?? pkg.versions[0] ?? "",
      license: pkg.license,
      texts: licenseTexts(path),
    })),
  );
  const bundledDev = BUNDLED_DEV_PACKAGES.map((name) => {
    const dir = join(ROOT, "node_modules", name);
    const manifest = packageJsonSchema.parse(
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    );
    return { ...manifest, texts: licenseTexts(dir) };
  });
  return [...packages, ...bundledDev];
}

function cargoLicenses(): z.infer<typeof cargoAboutSchema> {
  const output = execSync("cargo about generate --format json -c about.toml", {
    cwd: join(ROOT, "src-tauri"),
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    // 進み具合と警告は画面に出したまま、JSON だけを受け取る
    stdio: ["ignore", "pipe", "inherit"],
  });
  return cargoAboutSchema.parse(JSON.parse(output));
}

const npm = npmPackages();
const cargo = cargoLicenses();
const rejected = [
  ...npm
    .filter((pkg) => !isAllowedLicense(pkg.license))
    .map((pkg) => `npm: ${pkg.name} ${pkg.version} (${pkg.license})`),
  ...cargo.licenses
    .filter((license) => !isAllowedLicense(license.id))
    .map((license) => `crate: ${license.id}`),
];
if (rejected.length > 0) {
  process.stderr.write(
    `許可の一覧に無いライセンスがあります。入れてよいかを確かめてから scripts/lib/licenses.ts と src-tauri/about.toml を直してください:\n${rejected.join("\n")}\n`,
  );
  process.exit(1);
}

const other = OTHER_NOTICES.map(({ license, packages, file }) => ({
  license,
  packages,
  text: readFileSync(join(import.meta.dirname, "notices", file), "utf8"),
}));
writeFileSync(
  OUTPUT,
  renderNotice({ npm: groupNpmLicenses(npm), cargo: groupCargoLicenses(cargo), other }),
);

const crates = new Set(
  cargo.licenses.flatMap((license) =>
    license.used_by.map(({ crate }) => `${crate.name}@${crate.version}`),
  ),
);
process.stdout.write(
  `THIRD_PARTY_LICENSES.txt を書きました（npm ${String(npm.length)} 個、crate ${String(crates.size)} 個）\n`,
);
const missing = npm.filter((pkg) => pkg.texts.length === 0).map((pkg) => pkg.name);
if (missing.length > 0) {
  process.stdout.write(`ライセンス文のファイルが無い npm パッケージ: ${missing.join(", ")}\n`);
}
