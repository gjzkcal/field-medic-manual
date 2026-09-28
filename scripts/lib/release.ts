// 版とリリースノートの扱い。版の正は package.json で、tauri.conf.json はそれを参照する。
// Cargo.toml / Cargo.lock の版はアプリの表示には使われないが、ずれると混乱するので同じ値にそろえる。

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CRATE_NAME = "field-medic-manual";

// updater は latest.json の版を SemVer として比べるので、形の違う版を出さないようにする
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemver(version: string): boolean {
  return SEMVER.test(version);
}

/** タグ（`v0.0.1`）から版（`0.0.1`）を取り出す。形が違えば null */
export function versionFromTag(tag: string): string | null {
  const version = tag.startsWith("v") ? tag.slice(1) : null;
  return version !== null && isSemver(version) ? version : null;
}

const PACKAGE_JSON_VERSION = /^(\s*"version":\s*")([^"]*)(")/m;

export function readPackageJsonVersion(text: string): string | null {
  return PACKAGE_JSON_VERSION.exec(text)?.[2] ?? null;
}

// JSON を読み直して書き出すと整形が変わり差分が大きくなるので、版の行だけを置き換える
export function replacePackageJsonVersion(text: string, version: string): string {
  return replaceOnce(text, PACKAGE_JSON_VERSION, version, "package.json");
}

// [package] の節の中の version だけを対象にする（依存の version = "…" に当たらないように）
const CARGO_TOML_VERSION = /(\[package\][^[]*?\nversion\s*=\s*")([^"]*)(")/;

export function readCargoTomlVersion(text: string): string | null {
  return CARGO_TOML_VERSION.exec(text)?.[2] ?? null;
}

export function replaceCargoTomlVersion(text: string, version: string): string {
  return replaceOnce(text, CARGO_TOML_VERSION, version, "Cargo.toml");
}

const CARGO_LOCK_VERSION = new RegExp(
  `(\\[\\[package\\]\\]\\r?\\nname = "${CRATE_NAME}"\\r?\\nversion = ")([^"]*)(")`,
);

export function readCargoLockVersion(text: string): string | null {
  return CARGO_LOCK_VERSION.exec(text)?.[2] ?? null;
}

export function replaceCargoLockVersion(text: string, version: string): string {
  return replaceOnce(text, CARGO_LOCK_VERSION, version, "Cargo.lock");
}

function replaceOnce(text: string, pattern: RegExp, version: string, file: string): string {
  if (!pattern.test(text)) {
    throw new Error(`${file} に版の行が見つかりません`);
  }
  return text.replace(pattern, (_match, head: string, _old: string, tail: string) =>
    [head, version, tail].join(""),
  );
}

export interface RepoVersions {
  packageJson: string | null;
  cargoToml: string | null;
  cargoLock: string | null;
}

export const REPO_FILES = {
  packageJson: "package.json",
  cargoToml: join("src-tauri", "Cargo.toml"),
  cargoLock: join("src-tauri", "Cargo.lock"),
  changelog: "CHANGELOG.md",
} as const;

export function readRepoVersions(root: string): RepoVersions {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return {
    packageJson: readPackageJsonVersion(read(REPO_FILES.packageJson)),
    cargoToml: readCargoTomlVersion(read(REPO_FILES.cargoToml)),
    cargoLock: readCargoLockVersion(read(REPO_FILES.cargoLock)),
  };
}

/**
 * CHANGELOG.md からその版の節（`## [0.0.1] - 2026-09-29` の次の行から、次の `## ` の前まで）を取り出す。
 * Releases の本文と latest.json の notes になり、アプリの更新のダイアログに「変更点」として出る。
 */
export function extractReleaseNotes(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return notes === "" ? null : notes;
}
