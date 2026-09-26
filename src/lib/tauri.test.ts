import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  appVersion,
  assetPut,
  docDelete,
  docUpsert,
  errorMessage,
  isAppError,
  searchQuery,
  synonymSave,
  triageDelete,
  triageGet,
  triageList,
  triageUpsert,
} from "@/lib/tauri";

afterEach(() => {
  clearMocks();
});

describe("appVersion", () => {
  it("app_version コマンドの戻り値を返す", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd === "app_version" ? "0.1.0" : undefined;
    });

    await expect(appVersion()).resolves.toBe("0.1.0");
    expect(calls).toEqual(["app_version"]);
  });
});

describe("isAppError", () => {
  it("Rust の AppError の形を受け入れる", () => {
    expect(isAppError({ kind: "not_found", message: "見つかりません: doc 42" })).toBe(true);
  });

  it("未知の kind や形の違う値を拒否する", () => {
    expect(isAppError({ kind: "unknown", message: "x" })).toBe(false);
    expect(isAppError({ kind: "io" })).toBe(false);
    expect(isAppError("io")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe("データ層のラッパ", () => {
  function recordCalls(result: unknown): { cmd: string; payload: unknown }[] {
    const calls: { cmd: string; payload: unknown }[] = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      return result;
    });
    return calls;
  }

  it("docUpsert は input に包んで送る", async () => {
    const calls = recordCalls("doc-1");
    const input = {
      title: "t",
      sourceType: "markdown" as const,
      sourcePath: null,
      sourceHash: "h",
      meta: { modTarget: null, modChannel: null, modVersion: null, verifiedAt: null, tags: [] },
      sections: [],
      assetIds: [],
      originalAssetId: null,
    };

    await expect(docUpsert(input)).resolves.toBe("doc-1");
    expect(calls).toEqual([{ cmd: "doc_upsert", payload: { input } }]);
  });

  it("docDelete は id を送る", async () => {
    const calls = recordCalls(null);

    await docDelete("doc-1");
    expect(calls).toEqual([{ cmd: "doc_delete", payload: { id: "doc-1" } }]);
  });

  it("assetPut は bytes を JSON に包まずそのまま送る", async () => {
    const calls = recordCalls("sha");
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(assetPut(bytes, { fileName: "図 1.png", mime: "image/png" })).resolves.toBe("sha");
    expect(calls).toEqual([{ cmd: "asset_put", payload: bytes }]);
  });

  it("searchQuery は省略した limit と filter を null で送る", async () => {
    const calls = recordCalls([]);

    await searchQuery("止血帯");
    await searchQuery("CPR", { limit: 5, filter: { modChannel: "dev" } });
    expect(calls).toEqual([
      { cmd: "search_query", payload: { q: "止血帯", limit: null, filter: null } },
      { cmd: "search_query", payload: { q: "CPR", limit: 5, filter: { modChannel: "dev" } } },
    ]);
  });

  it("synonymSave は group に包んで送る", async () => {
    const calls = recordCalls({ id: 1, terms: ["a", "b"], note: null, updatedAt: "x" });
    const group = { id: null, terms: ["a", "b"], note: null };

    await synonymSave(group);
    expect(calls).toEqual([{ cmd: "synonym_save", payload: { group } }]);
  });

  it("triage のラッパは input / id で送る", async () => {
    const calls = recordCalls(null);
    const input = {
      id: "f",
      title: "t",
      description: null,
      modTargets: [],
      modChannel: null,
      verifiedAt: null,
      version: 1,
      json: "{}",
      searchText: "",
      sourceHash: "h",
    };

    await triageUpsert(input);
    await triageGet("f");
    await triageDelete("f");
    await triageList();
    expect(calls).toEqual([
      { cmd: "triage_upsert", payload: { input } },
      { cmd: "triage_get", payload: { id: "f" } },
      { cmd: "triage_delete", payload: { id: "f" } },
      { cmd: "triage_list", payload: {} },
    ]);
  });
});

describe("errorMessage", () => {
  it("AppError なら message、それ以外は文字列にする", () => {
    expect(errorMessage({ kind: "invalid_input", message: "入力が不正です: x" })).toBe(
      "入力が不正です: x",
    );
    expect(errorMessage("boom")).toBe("boom");
  });
});
