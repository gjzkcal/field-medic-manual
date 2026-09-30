import { describe, expect, it } from "vitest";

import { convertManual } from "@/features/content/markdown";
import type { ManualSource, ReadImage } from "@/features/content/types";
import { CONVERT_TIMEOUT_MS, noImages } from "@/test/samples";

function manual(text: string, fileName = "x.md"): ManualSource {
  return { fileName, path: `/content/manuals/${fileName}`, text, hash: "h" };
}

// 同梱の原稿には画像を置いていないので、読む先のパスを確かめたうえで PNG の先頭のバイト列を返す
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const readSampleImage: ReadImage = (path) =>
  path === "/content/manuals/images/diagram.png"
    ? Promise.resolve(PNG_SIGNATURE)
    : Promise.reject(new Error(`想定外の画像: ${path}`));

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

describe("convertManual", { timeout: CONVERT_TIMEOUT_MS }, () => {
  it("front matter・見出し・節のタグ・表・Alert・画像を変換する", async () => {
    const { doc, warnings } = await convertManual(manual(SAMPLE, "hemorrhage.md"), readSampleImage);

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

  it("グラフの印を読み、直後の表に data-chart を付けて印を消す", async () => {
    const { doc, warnings } = await convertManual(
      manual(
        "# A\n\n<!-- chart: x=経過; y=SpO2; ref=85 -->\n\n| 経過 | SpO2 |\n|---|---|\n| 0 s | 97.1% |\n| 5 s | 92.0% |\n",
      ),
      noImages,
    );
    expect(warnings).toEqual([]);
    const html = doc.sections[0]?.html ?? "";
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(JSON.parse(container.querySelector("table")?.getAttribute("data-chart") ?? "")).toEqual(
      { x: "経過", y: ["SpO2"], y2: [], ref: [85], title: null },
    );
    expect(html).not.toContain("chart:");
    expect(doc.sections[0]?.plainText).not.toContain("chart");
  });

  it.each([
    ["表でない", "<!-- chart: x=経過; y=SpO2 -->\n\n本文", "印のすぐ後に表がありません"],
    [
      "列が無い",
      "<!-- chart: x=経過; y=脈 -->\n| 経過 | SpO2 |\n|---|---|\n| 0 s | 97% |\n| 5 s | 92% |",
      "列「脈」が表にありません",
    ],
    ["キーの誤り", "<!-- chart: x=経過; z=SpO2 -->\n| 経過 |\n|---|\n| 0 s |", "知らないキー"],
  ])("グラフの印の誤り（%s）は警告にし、表には印を付けない", async (_, body, message) => {
    const { doc, warnings } = await convertManual(manual(`# A\n\n${body}\n`), noImages);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("グラフの印「chart:");
    expect(warnings[0]).toContain(message);
    expect(doc.sections[0]?.html).not.toContain("data-chart");
  });

  it("生の HTML の script は取り除く", async () => {
    const { doc } = await convertManual(
      manual('# A\n<script>alert(1)</script>\n\n<b onclick="x()">太字</b>'),
      noImages,
    );
    expect(doc.sections[0]?.html).toBe("<p><b>太字</b></p>");
  });
});
