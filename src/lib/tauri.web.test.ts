// Web 版の実装（tauri.web.ts）が、デスクトップ版（tauri.ts）の代わりに使えることを確かめる。
import { afterEach, describe, expect, it } from "vitest";

import { bundledManuals } from "@/features/content/bundle";
import { isAppError } from "@/lib/app-error";
import * as desktop from "@/lib/tauri";
import * as web from "@/lib/tauri.web";
import { CONVERT_TIMEOUT_MS } from "@/test/samples";
import { readLocalSetting, writeLocalSetting } from "@/web/local-settings";

afterEach(() => {
  localStorage.clear();
});

describe("tauri.web.ts", () => {
  it("デスクトップ版と同じ名前と型の関数を持つ", () => {
    // 関数を足し忘れたり型がずれたりすると、ここが tsc（pnpm lint）で落ちる
    const api: typeof desktop = web;
    expect(Object.keys(api).sort()).toEqual(Object.keys(desktop).sort());
  });

  describe("同梱した原稿", { timeout: CONVERT_TIMEOUT_MS * 2 }, () => {
    it("すべての原稿を一覧に出し、ファイル名の id で開ける", async () => {
      const manuals = await bundledManuals();
      const docs = await web.docList();
      expect(docs.map((d) => `${d.id}.md`).sort()).toEqual(manuals.map((m) => m.fileName).sort());
      for (const summary of docs) {
        const detail = await web.docGet(summary.id);
        expect(detail.sections.length, summary.id).toBeGreaterThan(0);
      }
      const outline = await web.docOutline();
      expect(outline.map((d) => d.id)).toEqual(docs.map((d) => d.id));
    });

    it("ない原稿は not_found で失敗する（ビューアが「見つかりません」を出す）", async () => {
      const error: unknown = await web.docGet("no-such-manual").catch((e: unknown) => e);
      expect(isAppError(error) && error.kind).toBe("not_found");
    });

    it("同義語で検索でき、クイック表を読める", async () => {
      const hits = await web.searchQuery("TQ");
      expect(hits.some((h) => h.kind === "section")).toBe(true);
      expect((await web.quickrefList()).rows.length).toBeGreaterThan(0);
      expect((await web.tagList()).length).toBeGreaterThan(0);
    });
  });

  it("設定を localStorage に保存して読み戻す", async () => {
    expect(await web.settingsGet("viewer")).toBeNull();
    await web.settingsSet("viewer", { fontSize: "xl" });
    expect(await web.settingsGet("viewer")).toEqual({ fontSize: "xl" });
    // ほかのサイトと origin を共有するので、名前の付いたキーに入れる
    expect(localStorage.getItem("field-medic-manual:settings:viewer")).toBe('{"fontSize":"xl"}');
  });

  it("Web 版にない機能は、空の結果か何もしない", async () => {
    expect(await web.favList()).toEqual([]);
    expect(await web.historyList(10)).toEqual([]);
    expect(await web.triageList()).toEqual([]);
    expect(await web.checkForUpdate()).toBeNull();
    expect(web.currentWindowLabel()).toBe("main");
    const error: unknown = await web
      .favToggle({ kind: "flow", flowId: "x" })
      .catch((e: unknown) => e);
    expect(isAppError(error) && error.kind).toBe("invalid_input");
  });
});

describe("local-settings", () => {
  function brokenStorage(): Storage {
    throw new Error("SecurityError");
  }

  it("読めなければ null にして、既定値で動かす", () => {
    expect(readLocalSetting("viewer", brokenStorage)).toBeNull();
  });

  it("壊れた JSON も null にする", () => {
    localStorage.setItem("field-medic-manual:settings:viewer", "{");
    expect(readLocalSetting("viewer")).toBeNull();
  });

  it("書けなければ io のエラーにする", () => {
    let thrown: unknown;
    try {
      writeLocalSetting("viewer", {}, brokenStorage);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isAppError(thrown) && thrown.kind).toBe("io");
  });
});
