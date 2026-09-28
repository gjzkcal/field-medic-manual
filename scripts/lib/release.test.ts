import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractReleaseNotes,
  isSemver,
  readCargoLockVersion,
  readCargoTomlVersion,
  readPackageJsonVersion,
  readRepoVersions,
  REPO_FILES,
  replaceCargoLockVersion,
  replaceCargoTomlVersion,
  replacePackageJsonVersion,
  versionFromTag,
} from "./release.ts";

const ROOT = join(import.meta.dirname, "..", "..");

describe("版の形", () => {
  it("SemVer だけを受け付ける", () => {
    expect(isSemver("0.0.1")).toBe(true);
    expect(isSemver("1.2.3-rc.1")).toBe(true);
    expect(isSemver("1.2")).toBe(false);
    expect(isSemver("v1.2.3")).toBe(false);
    expect(isSemver("01.2.3")).toBe(false);
  });

  it("タグから版を取り出す", () => {
    expect(versionFromTag("v0.0.2")).toBe("0.0.2");
    expect(versionFromTag("0.0.2")).toBeNull();
    expect(versionFromTag("v0.0")).toBeNull();
  });
});

describe("版の書き換え", () => {
  it("package.json は版の行だけを変える", () => {
    const text = '{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": {}\n}\n';
    const next = replacePackageJsonVersion(text, "0.0.2");
    expect(next).toBe('{\n  "name": "x",\n  "version": "0.0.2",\n  "dependencies": {}\n}\n');
    expect(readPackageJsonVersion(next)).toBe("0.0.2");
  });

  it("Cargo.toml は [package] の版だけを変え、依存の version には触れない", () => {
    const text = [
      "[package]",
      'name = "field-medic-manual"',
      'version = "0.1.0"',
      'authors = ["a"]',
      "",
      "[dependencies]",
      'tauri = { version = "2" }',
      "",
    ].join("\n");
    const next = replaceCargoTomlVersion(text, "0.0.2");
    expect(readCargoTomlVersion(next)).toBe("0.0.2");
    expect(next).toContain('tauri = { version = "2" }');
  });

  it("Cargo.lock は自分のクレートの版だけを変える", () => {
    const text = [
      "[[package]]",
      'name = "fastrand"',
      'version = "2.3.0"',
      "",
      "[[package]]",
      'name = "field-medic-manual"',
      'version = "0.1.0"',
      "",
    ].join("\n");
    const next = replaceCargoLockVersion(text, "0.0.2");
    expect(readCargoLockVersion(next)).toBe("0.0.2");
    expect(next).toContain('name = "fastrand"\nversion = "2.3.0"');
  });

  it("版の行が無ければ失敗する", () => {
    expect(() => replaceCargoLockVersion("", "0.0.2")).toThrow("Cargo.lock");
  });
});

describe("リリースノート", () => {
  const changelog = [
    "# 変更履歴",
    "",
    "## [0.0.2] - 2026-09-30",
    "",
    "### 変更",
    "- B",
    "",
    "## [0.0.1] - 2026-09-29",
    "",
    "- A",
    "",
  ].join("\n");

  it("その版の節だけを取り出す", () => {
    expect(extractReleaseNotes(changelog, "0.0.2")).toBe("### 変更\n- B");
    expect(extractReleaseNotes(changelog, "0.0.1")).toBe("- A");
  });

  it("節が無ければ null", () => {
    expect(extractReleaseNotes(changelog, "0.0.3")).toBeNull();
  });
});

// リリースの前に、版のずれと変更点の書き漏らしを `pnpm test` で見つけるため
describe("リポジトリの版", () => {
  it("package.json・Cargo.toml・Cargo.lock の版がそろっている", () => {
    const versions = readRepoVersions(ROOT);
    expect(versions.packageJson).not.toBeNull();
    expect(versions.cargoToml).toBe(versions.packageJson);
    expect(versions.cargoLock).toBe(versions.packageJson);
  });

  it("tauri.conf.json は package.json の版を参照する", () => {
    const conf: unknown = JSON.parse(
      readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    expect(conf).toMatchObject({ version: "../package.json" });
  });

  it("CHANGELOG.md に今の版の節がある", () => {
    const { packageJson } = readRepoVersions(ROOT);
    const changelog = readFileSync(join(ROOT, REPO_FILES.changelog), "utf8");
    expect(extractReleaseNotes(changelog, packageJson ?? "")).not.toBeNull();
  });
});
