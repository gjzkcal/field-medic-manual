import { describe, expect, it } from "vitest";

import { decodeAnchor, docHref, highlightTermsOf, resolveLink } from "@/features/library/link";

describe("resolveLink", () => {
  it("http / https / mailto は外部リンク", () => {
    expect(resolveLink("https://anvil.acemod.org/dev/")).toEqual({
      kind: "external",
      url: "https://anvil.acemod.org/dev/",
    });
    expect(resolveLink("HTTP://example.com").kind).toBe("external");
    expect(resolveLink("mailto:a@example.com").kind).toBe("external");
  });

  it("# だけは同じ文書のアンカー。% エンコードを戻す", () => {
    expect(resolveLink("#%E6%AD%A2%E8%A1%80%E5%B8%AF%E3%82%92%E4%BD%BF%E3%81%86")).toEqual({
      kind: "anchor",
      anchor: "止血帯を使う",
    });
    expect(resolveLink("#").kind).toBe("unknown");
  });

  it("相対パスの md は別の文書へのリンク", () => {
    expect(resolveLink("hemorrhage.md#cpr-%E3%81%AE%E6%89%8B%E9%A0%86")).toEqual({
      kind: "doc",
      fileName: "hemorrhage.md",
      anchor: "cpr-の手順",
    });
    expect(resolveLink("./Airway.md")).toEqual({
      kind: "doc",
      fileName: "airway.md",
      anchor: null,
    });
  });

  it("それ以外（javascript:、別フォルダ、md 以外）は開かない", () => {
    expect(resolveLink("javascript:alert(1)").kind).toBe("unknown");
    expect(resolveLink("../other/a.md").kind).toBe("unknown");
    expect(resolveLink("images/diagram.png").kind).toBe("unknown");
    expect(resolveLink("file:///C:/Windows").kind).toBe("unknown");
  });
});

describe("decodeAnchor", () => {
  it("不正な % の並びはそのまま返す", () => {
    expect(decodeAnchor("100%")).toBe("100%");
  });
});

describe("docHref", () => {
  it("アンカーを % エンコードして付ける", () => {
    expect(docHref("d1", null)).toBe("/doc/d1");
    expect(docHref("d1", "止血帯")).toBe("/doc/d1#%E6%AD%A2%E8%A1%80%E5%B8%AF");
  });

  it("ハイライトする語は検索部分に載せ、読み出すと元に戻る", () => {
    const href = docHref("d1", "a", ["止血帯", "C&P R"]);
    expect(href).toMatch(/^\/doc\/d1\?hl=.+&hl=.+#a$/u);
    const search = href.slice(href.indexOf("?"), href.indexOf("#"));
    expect(highlightTermsOf(search)).toEqual(["止血帯", "C&P R"]);
  });

  it("空の語は読み出さない", () => {
    expect(highlightTermsOf("?hl=&hl=%20&hl=TQ")).toEqual(["TQ"]);
    expect(highlightTermsOf("")).toEqual([]);
  });
});
