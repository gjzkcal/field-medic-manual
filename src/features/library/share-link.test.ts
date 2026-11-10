import { describe, expect, it } from "vitest";

import { manualSourcePath } from "@/features/content/path";
import { decodeAnchor } from "@/features/library/link";
import { shareUrl, webDocId } from "@/features/library/share-link";

describe("shareUrl", () => {
  it("Web 版の公開先の URL を、原稿のファイル名の id で作る", () => {
    expect(shareUrl(manualSourcePath("hemorrhage.md"), null)).toBe(
      "https://gjzkcal.github.io/field-medic-manual/doc/hemorrhage",
    );
  });

  it("日本語のアンカーは % エンコードし、ビューアの読み方で元に戻る", () => {
    const url = new URL(shareUrl(manualSourcePath("hemorrhage.md"), "止血帯を使う"));
    expect(url.pathname).toBe("/field-medic-manual/doc/hemorrhage");
    expect(url.hash).toBe(`#${encodeURIComponent("止血帯を使う")}`);
    expect(decodeAnchor(url.hash.slice(1))).toBe("止血帯を使う");
  });

  it("検索語のハイライト（hl）は入れない", () => {
    expect(new URL(shareUrl(manualSourcePath("hemorrhage.md"), "a")).search).toBe("");
  });
});

describe("webDocId", () => {
  it("Windows のパスでも拡張子を除いたファイル名にする", () => {
    expect(webDocId("C:\\content\\manuals\\cardiac-arrest.md")).toBe("cardiac-arrest");
  });
});
