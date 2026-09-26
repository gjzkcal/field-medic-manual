import { describe, expect, it } from "vitest";

import { AnchorAllocator } from "@/features/content/anchor";
import { sectionsFromHtml } from "@/features/content/document";
import { resolveRelative } from "@/features/content/path";

describe("AnchorAllocator", () => {
  it("GitHub 形式のスラッグを作り、日本語は残す", () => {
    const anchors = new AnchorAllocator();
    expect(anchors.allocate("Step 1: 止血帯を使う！")).toBe("step-1-止血帯を使う");
    expect(anchors.allocate("CPR / 胸骨圧迫")).toBe("cpr--胸骨圧迫");
  });

  it("重複したら -2 -3 を付け、空なら代わりの名前にする", () => {
    const anchors = new AnchorAllocator();
    expect(anchors.allocate("出血")).toBe("出血");
    expect(anchors.allocate("出血")).toBe("出血-2");
    expect(anchors.allocate("出血")).toBe("出血-3");
    expect(anchors.allocate("！？")).toBe("section");
  });
});

describe("resolveRelative", () => {
  it("Windows と / 区切りのパスを解決する", () => {
    expect(resolveRelative("C:\\docs\\a\\止血.md", "../images/%E5%9B%B3.png")).toBe(
      "C:\\docs\\images\\図.png",
    );
    expect(resolveRelative("/home/u/a.md", "./img/x.png?v=1")).toBe("/home/u/img/x.png");
  });

  it("URL と絶対パスは null", () => {
    expect(resolveRelative("C:\\a.md", "https://example.com/x.png")).toBeNull();
    expect(resolveRelative("C:\\a.md", "C:\\x.png")).toBeNull();
    expect(resolveRelative("C:\\a.md", "/x.png")).toBeNull();
  });
});

describe("sectionsFromHtml", () => {
  it("h1〜h3 で分け、h4 以降と導入部は本文に残す", async () => {
    const { sections, firstH1 } = await sectionsFromHtml(
      "<p>はじめに</p><h1>止血</h1><p>概要</p><h2>包帯</h2><h4>細目</h4><p>巻く</p><h3>注意</h3><p>締めすぎない</p>",
    );
    expect(sections.map((s) => [s.level, s.title, s.anchor])).toEqual([
      [0, "", "intro"],
      [1, "止血", "止血"],
      [2, "包帯", "包帯"],
      [3, "注意", "注意"],
    ]);
    expect(sections[2]?.html).toBe("<h4>細目</h4><p>巻く</p>");
    expect(sections[2]?.plainText).toBe("細目\n\n巻く");
    expect(firstH1).toBe("止血");
  });

  it("見出しを含む入れ物（div / section）は展開してから分ける", async () => {
    const { sections } = await sectionsFromHtml(
      "<div><section><h2>A</h2><p>a</p></section><section><h2>B</h2><p>b</p></section></div>",
    );
    expect(sections.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("見出し直後のコメントと「タグ:」の段落をセクションのタグにし、本文から除く", async () => {
    const { sections } = await sectionsFromHtml(
      "<h2>止血帯</h2>\n<!-- tags: TQ, 四肢 -->\n<p>本文</p><h2>包帯</h2><p>タグ：Bandage、圧迫</p><p>本文</p><h2>他</h2><p>本文</p><p>タグ: 後ろの行は対象外</p>",
    );
    expect(sections.map((s) => s.tags)).toEqual([["TQ", "四肢"], ["Bandage", "圧迫"], []]);
    expect(sections[1]?.plainText).toBe("本文");
    expect(sections[0]?.html).not.toContain("tags");
  });

  it("script・イベント属性・javascript: URL・style を取り除く", async () => {
    const { sections } = await sectionsFromHtml(
      '<h2 onclick="x()">見出し</h2><script>alert(1)</script><p style="color:red" onmouseover="x()">本文<a href="javascript:alert(1)">危険</a><a href="https://example.com">安全</a></p><iframe src="https://example.com"></iframe>',
    );
    const html = sections[0]?.html ?? "";
    expect(html).not.toMatch(/script|onclick|onmouseover|javascript:|style=|iframe/);
    expect(html).toContain('<a href="https://example.com">安全</a>');
  });

  it("data URI の画像はアセットにし、外部の画像はリンク、読めない画像は消して警告する", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const { sections, assets, warnings } = await sectionsFromHtml(
      `<h2>図</h2><p><img src="${png}" alt="図1"><img src="${png}"><img src="https://example.com/a/b.png" alt="外部"><img src="missing.png"></p>`,
    );
    expect(assets).toHaveLength(1);
    expect(assets[0]?.mime).toBe("image/png");
    const html = sections[0]?.html ?? "";
    expect(html).toContain(`<img alt="図1" data-asset-id="${assets[0]?.id ?? ""}">`);
    expect(html).not.toContain("src=");
    expect(html).toContain('<a href="https://example.com/a/b.png">[画像: 外部]</a>');
    expect(warnings).toEqual(["画像を読み込めませんでした: missing.png"]);
  });

  it("相対パスの画像は resolveImage で読む", async () => {
    const { assets, sections } = await sectionsFromHtml('<h2>図</h2><img src="img/a.png">', {
      resolveImage: (src) =>
        Promise.resolve({ id: "abc", fileName: src, mime: "image/png", bytes: new Uint8Array() }),
    });
    expect(assets.map((a) => a.fileName)).toEqual(["img/a.png"]);
    expect(sections[0]?.html).toBe('<img data-asset-id="abc">');
  });
});
