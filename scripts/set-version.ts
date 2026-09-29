// 使い方: pnpm version:set 0.0.2
// package.json・Cargo.toml・Cargo.lock の版をそろえて書き換える（tauri.conf.json は package.json を参照している）。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import {
  isSemver,
  readRepoVersions,
  REPO_FILES,
  replaceCargoLockVersion,
  replaceCargoTomlVersion,
  replacePackageJsonVersion,
} from "./lib/release.ts";

const ROOT = join(import.meta.dirname, "..");
const version = process.argv[2] ?? "";

if (!isSemver(version)) {
  process.stderr.write(`版は SemVer（例: 0.0.2）で指定してください: "${version}"\n`);
  process.exit(1);
}

const before = readRepoVersions(ROOT);
const edits = [
  [REPO_FILES.packageJson, replacePackageJsonVersion],
  [REPO_FILES.cargoToml, replaceCargoTomlVersion],
  [REPO_FILES.cargoLock, replaceCargoLockVersion],
] as const;
for (const [file, replace] of edits) {
  const path = join(ROOT, file);
  writeFileSync(path, replace(readFileSync(path, "utf8"), version));
}

process.stdout.write(
  `版を ${before.packageJson ?? "?"} から ${version} に変えました。CHANGELOG.md の ## [Unreleased] の見出しを ## [${version}] - 日付 に書き換えてください。\n`,
);
