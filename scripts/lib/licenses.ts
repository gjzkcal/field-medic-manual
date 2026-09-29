// 依存ライブラリのライセンス表記（THIRD_PARTY_LICENSES.txt）を組み立てる部分。
// MIT・Apache-2.0・BSD・ISC・OFL などは、配布物に著作権表示とライセンス文を入れることが条件。

import { z } from "zod";

/**
 * 配布してよいライセンス（GPL-3.0-or-later と両立するもの）。
 * Rust 側は src-tauri/about.toml の accepted に同じ一覧を書く（テストで一致を確かめる）。
 * 一覧に無いものが出たら生成を失敗させ、依存を入れる前と同じくユーザーに確認してから足す。
 */
export const ALLOWED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
  "MPL-2.0",
  "OFL-1.1",
  "CC0-1.0",
  "Unlicense",
  "BSL-1.0",
  "0BSD",
] as const;

const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_LICENSES);

/**
 * SPDX の式（`MIT OR Apache-2.0`、`(MPL-2.0 OR Apache-2.0)`、`Apache-2.0 AND ISC` など）が許可の一覧で満たせるか。
 * OR はどれか 1 つ、AND はすべてが許可されていればよい。
 */
export function isAllowedLicense(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;

  const peek = (): string | undefined => tokens[pos];
  const next = (): string | undefined => tokens[pos++];

  function parseOr(): boolean {
    let ok = parseAnd();
    while (peek() === "OR") {
      next();
      // 右側も読み進めるため、短絡させずに評価する
      const right = parseAnd();
      ok = ok || right;
    }
    return ok;
  }

  function parseAnd(): boolean {
    let ok = parseAtom();
    while (peek() === "AND") {
      next();
      const right = parseAtom();
      ok = ok && right;
    }
    return ok;
  }

  function parseAtom(): boolean {
    const token = next();
    if (token === "(") {
      const ok = parseOr();
      return next() === ")" && ok;
    }
    if (token === undefined || token === ")" || token === "OR" || token === "AND") {
      return false;
    }
    if (peek() === "WITH") {
      next();
      const exception = next() ?? "";
      return ALLOWED.has(`${token} WITH ${exception}`);
    }
    return ALLOWED.has(token);
  }

  const ok = parseOr();
  return ok && pos === tokens.length;
}

/** 同じライセンス文を使うパッケージをまとめた 1 節 */
export interface LicenseGroup {
  license: string;
  packages: string[];
  text: string;
}

export interface NpmPackageLicense {
  name: string;
  version: string;
  license: string;
  /** パッケージに入っている LICENSE / COPYING / NOTICE の本文 */
  texts: string[];
}

const NO_LICENSE_FILE =
  "（このパッケージにはライセンス文のファイルが含まれていません。ライセンスは上の識別子のとおりです）";

/** 同じ本文（著作権表示を含む）のパッケージを 1 節にまとめ、同じ MIT の本文を何百回も並べないようにする */
export function groupNpmLicenses(packages: readonly NpmPackageLicense[]): LicenseGroup[] {
  const groups = new Map<string, LicenseGroup>();
  for (const pkg of packages) {
    const text = pkg.texts.length > 0 ? pkg.texts.join("\n\n") : NO_LICENSE_FILE;
    const key = `${pkg.license}\u0000${normalizeText(text)}`;
    const label = `${pkg.name} ${pkg.version}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { license: pkg.license, packages: [label], text });
    } else if (!group.packages.includes(label)) {
      group.packages.push(label);
    }
  }
  return sortGroups([...groups.values()]);
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/** `pnpm licenses list --prod --json` の出力 */
export const pnpmLicensesSchema = z.record(
  z.string(),
  z.array(
    z.object({
      name: z.string(),
      versions: z.array(z.string()),
      paths: z.array(z.string()),
      license: z.string(),
    }),
  ),
);

/** `cargo about generate --format json` の出力のうち使う部分 */
export const cargoAboutSchema = z.object({
  licenses: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      used_by: z.array(z.object({ crate: z.object({ name: z.string(), version: z.string() }) })),
    }),
  ),
});

export function groupCargoLicenses(about: z.infer<typeof cargoAboutSchema>): LicenseGroup[] {
  return sortGroups(
    about.licenses.map((license) => ({
      license: license.id,
      packages: license.used_by.map(({ crate }) => `${crate.name} ${crate.version}`),
      text: license.text,
    })),
  );
}

function sortGroups(groups: LicenseGroup[]): LicenseGroup[] {
  for (const group of groups) {
    group.packages.sort((a, b) => a.localeCompare(b, "en"));
  }
  return groups.sort((a, b) => {
    const byLicense = a.license.localeCompare(b.license, "en");
    return byLicense !== 0
      ? byLicense
      : (a.packages[0] ?? "").localeCompare(b.packages[0] ?? "", "en");
  });
}

export interface NoticeInput {
  npm: readonly LicenseGroup[];
  cargo: readonly LicenseGroup[];
  /** 依存の一覧に出ないが exe に入るもの（Rust の標準ライブラリ、WebView2 の読み込み部） */
  other: readonly LicenseGroup[];
}

const RULE = "=".repeat(78);
const THIN_RULE = "-".repeat(78);

// 版を上げるたびに差分が出ないよう、アプリの版は書かない
export function renderNotice({ npm, cargo, other }: NoticeInput): string {
  const header = [
    "Field Medic Manual — Third-party licenses / サードパーティのライセンス",
    "",
    "This application is licensed under GPL-3.0-or-later (see LICENSE.txt).",
    "It includes the following third-party software under their own licenses.",
    "このアプリ本体は GPL-3.0-or-later です（LICENSE.txt）。",
    "以下のサードパーティのソフトウェアを含み、それぞれのライセンスに従って配布しています。",
  ];
  const section = (title: string, groups: readonly LicenseGroup[]): string[] => [
    RULE,
    title,
    RULE,
    ...groups.flatMap((group) => [
      "",
      THIN_RULE,
      `License: ${group.license}`,
      `Used by: ${group.packages.join(", ")}`,
      THIN_RULE,
      "",
      normalizeText(group.text),
    ]),
    "",
  ];
  return [
    ...header,
    "",
    ...section("JavaScript packages (npm) / 画面の部品など", npm),
    ...section("Rust crates / アプリの本体（Rust）", cargo),
    ...section("Other / その他", other),
  ].join("\n");
}
