// 使い方（リリースのワークフローから）: node scripts/release-notes.ts v0.0.2
// タグとリポジトリの版が一致することを確かめ、CHANGELOG.md のその版の節を標準出力に書く。
// 一致しなければ失敗させ、版を上げ忘れたタグで配布しないようにする。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import {
  extractReleaseNotes,
  readRepoVersions,
  REPO_FILES,
  versionFromTag,
} from "./lib/release.ts";

const ROOT = join(import.meta.dirname, "..");
const tag = process.argv[2] ?? "";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const version =
  versionFromTag(tag) ?? fail(`タグは v<SemVer>（例: v0.0.2）にしてください: "${tag}"`);
const versions = readRepoVersions(ROOT);
const foundVersions: [string, string | null][] = [
  [REPO_FILES.packageJson, versions.packageJson],
  [REPO_FILES.cargoToml, versions.cargoToml],
  [REPO_FILES.cargoLock, versions.cargoLock],
];
for (const [file, found] of foundVersions) {
  if (found !== version) {
    fail(`タグ ${tag} と ${file} の版（${found ?? "なし"}）が一致しません`);
  }
}

const notes =
  extractReleaseNotes(readFileSync(join(ROOT, REPO_FILES.changelog), "utf8"), version) ??
  fail(`CHANGELOG.md に ## [${version}] の節がありません`);
process.stdout.write(`${notes}\n`);
