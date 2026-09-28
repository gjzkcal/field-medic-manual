import { describe, expect, it } from "vitest";

import { hrefForMode, mainHrefOf } from "@/features/overlay/overlay-mode";
import type { PrefItem } from "@/lib/bindings/PrefItem";

function recent(...items: PrefItem["target"][]): PrefItem[] {
  return items.map((target) => ({ target, title: "t", context: null, at: "" }));
}

describe("hrefForMode", () => {
  it("閲覧は今の画面のまま、検索は検索のタブへ移る", () => {
    expect(hrefForMode("view", [])).toBeNull();
    expect(hrefForMode("search", [])).toBe("/search");
  });

  it("トリアージは履歴で最後に開いたフローを最初から開く", () => {
    const history = recent(
      { kind: "document", documentId: "d1" },
      { kind: "flow", flowId: "airway-breathing" },
      { kind: "flow", flowId: "first-contact" },
    );
    expect(hrefForMode("triage", history)).toBe("/triage/airway-breathing");
  });

  it("履歴にフローがなければフローの一覧を開く", () => {
    expect(hrefForMode("triage", recent({ kind: "document", documentId: "d1" }))).toBe("/triage");
  });
});

describe("mainHrefOf", () => {
  it("ビューアとトリアージは同じ画面をメインで開く", () => {
    expect(mainHrefOf({ pathname: "/doc/d1", search: "?hl=止血", hash: "#a" })).toBe(
      "/doc/d1?hl=止血#a",
    );
    expect(mainHrefOf({ pathname: "/triage/first-contact", search: "?path=0.1", hash: "" })).toBe(
      "/triage/first-contact?path=0.1",
    );
    expect(mainHrefOf({ pathname: "/triage", search: "", hash: "" })).toBe("/triage");
  });

  it("クイック表は、指した行と絞り込みを引き継いでメインで開く", () => {
    expect(mainHrefOf({ pathname: "/quickref", search: "?row=tension-ptx", hash: "" })).toBe(
      "/quickref?row=tension-ptx",
    );
    expect(mainHrefOf({ pathname: "/quickref", search: "?sev=4", hash: "" })).toBe(
      "/quickref?sev=4",
    );
  });

  it("小窓にしかない画面（検索・お気に入り）はライブラリを開く", () => {
    expect(mainHrefOf({ pathname: "/search", search: "", hash: "" })).toBe("/library");
    expect(mainHrefOf({ pathname: "/favorites", search: "", hash: "" })).toBe("/library");
  });
});
