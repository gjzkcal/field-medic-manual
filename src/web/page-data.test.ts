import { describe, expect, it } from "vitest";

import { pageDataParts } from "@/web/page-data";

describe("pageDataParts", () => {
  it.each([
    ["library", ["index"]],
    ["quickref", ["index", "quickref"]],
    ["triage", ["flows"]],
    ["triage/casualty-first-contact", ["flows"]],
  ])("%s は、最初の表示で読む部分を返す", (page, parts) => {
    expect(pageDataParts(page)).toStrictEqual(parts);
  });

  it.each(["doc/vitals-system", "casualties", "settings", "about", "", "no-such-page"])(
    "先読みしないページ（%s）は、何も返さない",
    (page) => {
      expect(pageDataParts(page)).toStrictEqual([]);
    },
  );
});
