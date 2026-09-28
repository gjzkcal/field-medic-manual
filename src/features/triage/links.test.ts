import { describe, expect, it } from "vitest";

import { parseFlowLink } from "@/features/triage/links";

describe("parseFlowLink", () => {
  it("doc: はファイル名とアンカーに分ける", () => {
    expect(parseFlowLink("doc:hemorrhage.md#止血帯を使う")).toEqual({
      kind: "doc",
      fileName: "hemorrhage.md",
      anchor: "止血帯を使う",
    });
    expect(parseFlowLink("doc:hemorrhage.md")).toEqual({
      kind: "doc",
      fileName: "hemorrhage.md",
      anchor: null,
    });
    expect(parseFlowLink("doc:cardiac-arrest.md#cpr-%E3%81%AE%E6%89%8B%E9%A0%86")).toEqual({
      kind: "doc",
      fileName: "cardiac-arrest.md",
      anchor: "cpr-の手順",
    });
  });

  it("flow: / quickref: / https: を読む", () => {
    expect(parseFlowLink("flow:airway-breathing")).toEqual({
      kind: "flow",
      flowId: "airway-breathing",
    });
    expect(parseFlowLink("quickref:tension-ptx")).toEqual({
      kind: "quickref",
      rowId: "tension-ptx",
    });
    // 行の id はスラッグなので、それ以外の書き方は書き間違いとして扱う
    expect(parseFlowLink("quickref:Tension_PTX")).toBeNull();
    expect(parseFlowLink("https://anvil.acemod.org/dev/")).toEqual({
      kind: "external",
      url: "https://anvil.acemod.org/dev/",
    });
  });

  it("書式に合わないものは null", () => {
    for (const text of [
      "doc:<documentId>#a",
      "doc:../manuals/a.md",
      "doc:Hemorrhage.md",
      "flow:Bad_Id",
      "http://example.com",
      "javascript:alert(1)",
      "hemorrhage.md#a",
      "",
    ]) {
      expect(parseFlowLink(text), text).toBeNull();
    }
  });
});
