import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_LICENSES,
  groupCargoLicenses,
  groupNpmLicenses,
  isAllowedLicense,
  renderNotice,
} from "./licenses.ts";

const ROOT = join(import.meta.dirname, "..", "..");

describe("isAllowedLicense", () => {
  it("許可の一覧にある識別子を受け付ける", () => {
    expect(isAllowedLicense("MIT")).toBe(true);
    expect(isAllowedLicense("OFL-1.1")).toBe(true);
  });

  it("OR はどれか 1 つ、AND はすべてが許可されていればよい", () => {
    expect(isAllowedLicense("MIT OR Apache-2.0")).toBe(true);
    expect(isAllowedLicense("(MPL-2.0 OR Apache-2.0)")).toBe(true);
    expect(isAllowedLicense("GPL-2.0-only OR MIT")).toBe(true);
    expect(isAllowedLicense("Apache-2.0 AND ISC")).toBe(true);
    expect(isAllowedLicense("MIT AND CC-BY-4.0")).toBe(false);
  });

  it("WITH の例外は組み合わせで判定する", () => {
    expect(isAllowedLicense("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isAllowedLicense("GPL-2.0-only WITH Classpath-exception-2.0")).toBe(false);
  });

  it("一覧に無いもの・壊れた式は受け付けない", () => {
    expect(isAllowedLicense("GPL-2.0-only")).toBe(false);
    expect(isAllowedLicense("Python-2.0")).toBe(false);
    expect(isAllowedLicense("")).toBe(false);
    expect(isAllowedLicense("(MIT")).toBe(false);
    expect(isAllowedLicense("MIT OR")).toBe(false);
  });
});

describe("groupNpmLicenses", () => {
  it("本文が同じパッケージは 1 節にまとめ、本文が無ければその旨を書く", () => {
    const groups = groupNpmLicenses([
      { name: "b", version: "1.0.0", license: "MIT", texts: ["MIT text (c) X"] },
      { name: "a", version: "2.0.0", license: "MIT", texts: ["MIT text (c) X\r\n"] },
      { name: "c", version: "1.0.0", license: "MIT", texts: ["MIT text (c) Y"] },
      { name: "d", version: "1.0.0", license: "ISC", texts: [] },
    ]);
    expect(groups.map((g) => [g.license, g.packages])).toEqual([
      ["ISC", ["d 1.0.0"]],
      ["MIT", ["a 2.0.0", "b 1.0.0"]],
      ["MIT", ["c 1.0.0"]],
    ]);
    expect(groups[0]?.text).toContain("含まれていません");
  });
});

describe("groupCargoLicenses", () => {
  it("cargo-about のライセンスごとに使っているクレートを並べる", () => {
    const groups = groupCargoLicenses({
      licenses: [
        {
          id: "MIT",
          text: "MIT",
          used_by: [
            { crate: { name: "zeta", version: "1.0.0" } },
            { crate: { name: "alpha", version: "0.1.0" } },
          ],
        },
      ],
    });
    expect(groups).toEqual([
      { license: "MIT", packages: ["alpha 0.1.0", "zeta 1.0.0"], text: "MIT" },
    ]);
  });
});

describe("renderNotice", () => {
  it("本体のライセンス・npm と Rust の節を含む", () => {
    const text = renderNotice({
      npm: [{ license: "MIT", packages: ["react 19.3.0"], text: "MIT License" }],
      cargo: [{ license: "Apache-2.0", packages: ["tauri 2.12.0"], text: "Apache License" }],
      other: [{ license: "MIT", packages: ["Rust standard library"], text: "MIT" }],
    });
    expect(text).toContain("GPL-3.0-or-later");
    expect(text).toContain("Used by: react 19.3.0");
    expect(text).toContain("Used by: tauri 2.12.0");
    expect(text).toContain("Used by: Rust standard library");
  });
});

// Rust 側の許可（cargo-about）と npm 側の許可がずれないようにする
describe("about.toml", () => {
  it("accepted が ALLOWED_LICENSES と一致する", () => {
    const toml = readFileSync(join(ROOT, "src-tauri", "about.toml"), "utf8");
    const accepted = /accepted\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "";
    const ids = [...accepted.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...ALLOWED_LICENSES]);
  });
});
