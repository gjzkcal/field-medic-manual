import { describe, expect, it } from "vitest";

import { pageDataParts } from "@/web/page-data";

describe("pageDataParts", () => {
  it.each([
    ["library", ["index"]],
    ["doc/vitals-system", ["index", "doc/vitals-system"]],
    ["quickref", ["index", "quickref"]],
    ["triage", ["flows"]],
    ["triage/casualty-first-contact", ["flows"]],
  ])("%s は、最初の表示で読む部分を返す", (page, parts) => {
    expect(pageDataParts(page)).toStrictEqual(parts);
  });

  it.each(["casualties", "settings", "about", "", "doc", "no-such-page"])(
    "原稿の表を読まないページ（%s）は、何も返さない",
    (page) => {
      expect(pageDataParts(page)).toStrictEqual([]);
    },
  );
});
