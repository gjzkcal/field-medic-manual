import { describe, expect, it } from "vitest";

import { convertManual } from "@/features/content/markdown";
import type { ManualSource } from "@/features/content/types";
import { noImages, readRepoFile } from "@/test/samples";

function manual(text: string, fileName = "x.md"): ManualSource {
  return { fileName, path: `/content/manuals/${fileName}`, text, hash: "h" };
}

const SAMPLE = `---
title: 止血
mod: core
verified_at: 2026-09-25
tags: [出血, 止血帯]
---

# 止血

導入の文。

## 出血の見分け方

<!-- tags: Bleeding, Class -->

| 程度 | 目安 |
|---|---|
| Class IV | 【要確認】 |

## 止血帯を使う

1. 【要確認】巻く。

> [!WARNING]
> 【要確認】注意書き。

![図](images/diagram.png)
`;

describe("convertManual", () => {
  it("front matter・見出し・節のタグ・表・Alert・画像を変換する", async () => {
    const { doc, warnings } = await convertManual(manual(SAMPLE, "hemorrhage.md"), readRepoFile);

    expect(warnings).toEqual([]);
    expect(doc.title).toBe("止血");
    expect(doc.sourceType).toBe("markdown");
    expect(doc.sourcePath).toBe("bundle://manuals/hemorrhage.md");
    expect(doc.sourceHash).toBe("h");
    expect(doc.meta).toEqual({
      modTarget: "core",
      modChannel: null,
      modVersion: null,
      verifiedAt: "2026-09-25",
      tags: ["出血", "止血帯"],
    });
    expect(doc.sections.map((s) => [s.level, s.title])).toEqual([
      [1, "止血"],
      [2, "出血の見分け方"],
      [2, "止血帯を使う"],
    ]);
    const [, signs, tourniquet] = doc.sections;
    expect(signs?.tags).toEqual(["Bleeding", "Class"]);
    expect(signs?.html).toContain("<table>");
    expect(signs?.plainText).toContain("Class IV");
    expect(tourniquet?.html).toContain(
      '<blockquote class="markdown-alert markdown-alert-warning">',
    );
    expect(tourniquet?.html).toContain('<p class="markdown-alert-title">警告</p>');
    expect(tourniquet?.html).not.toContain("[!WARNING]");

    expect(doc.assets.map((a) => [a.fileName, a.mime])).toEqual([["diagram.png", "image/png"]]);
    expect(tourniquet?.html).toContain(`data-asset-id="${doc.assets[0]?.id ?? ""}"`);
  });

  it("front matter がなければ最初の h1、それもなければファイル名をタイトルにする", async () => {
    const withH1 = await convertManual(manual("# 見出し\n本文"), noImages);
    expect(withH1.doc.title).toBe("見出し");
    const plain = await convertManual(manual("本文だけ"), noImages);
    expect(plain.doc.title).toBe("x");
    expect(plain.doc.sections.map((s) => s.level)).toEqual([0]);
  });

  it("不正なメタデータと読めない画像は警告にして変換を続ける", async () => {
    const { doc, warnings } = await convertManual(
      manual(
        "---\nmod: medic\nchannel: beta\nverified_at: 2026/09/25\nmod_version: 1.5\n---\n# A\n![x](images/missing.png)",
      ),
      noImages,
    );
    expect(doc.meta.modTarget).toBeNull();
    expect(doc.meta.modVersion).toBe("1.5");
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("images/missing.png");
  });

  it("生の HTML の script は取り除く", async () => {
    const { doc } = await convertManual(
      manual('# A\n<script>alert(1)</script>\n\n<b onclick="x()">太字</b>'),
      noImages,
    );
    expect(doc.sections[0]?.html).toBe("<p><b>太字</b></p>");
  });
});
