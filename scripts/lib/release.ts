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

export const REPO_URL = "https://github.com/gjzkcal/field-medic-manual";

const SECTION_HEADING = /^## \[([^\]]+)\]/;
// CHANGELOG の末尾に置く比較リンクの定義（`[0.0.1]: https://…`）
const LINK_DEFINITION = /^\[([^\]]+)\]:\s+(\S+)\s*$/;

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
  // 最も古い版の節の後ろは末尾のリンクの定義なので、そこで止める（変更点に URL の行が混ざらないように）
  const end = rest.findIndex((line) => line.startsWith("## ") || LINK_DEFINITION.test(line));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return notes === "" ? null : notes;
}

/** 節の見出しの名前（`Unreleased`・`0.0.1` など）を上から順に返す */
export function changelogSections(changelog: string): string[] {
  return changelog.split(/\r?\n/).flatMap((line) => {
    const name = SECTION_HEADING.exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
}

/** 末尾のリンクの定義を、名前 → URL で返す */
export function changelogLinks(changelog: string): Map<string, string> {
  const links = new Map<string, string>();
  for (const line of changelog.split(/\r?\n/)) {
    const match = LINK_DEFINITION.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      links.set(match[1], match[2]);
    }
  }
  return links;
}

/**
 * Keep a Changelog の形で、各節に張るべきリンクを返す。節は新しい順に並んでいる前提。
 * Unreleased は最新の版から HEAD まで、各版は 1 つ前の版からの比較、最も古い版はそのタグのリリース。
 */
export function expectedChangelogLinks(sections: readonly string[]): Map<string, string> {
  const links = new Map<string, string>();
  sections.forEach((name, i) => {
    const older = sections[i + 1];
    const head = name === "Unreleased" ? "HEAD" : `v${name}`;
    if (older !== undefined) {
      links.set(name, `${REPO_URL}/compare/v${older}...${head}`);
    } else if (name !== "Unreleased") {
      links.set(name, `${REPO_URL}/releases/tag/v${name}`);
    }
  });
  return links;
}
