import { describe, expect, it } from "vitest";

import { mirrorBundled, type BundledEntry, type StoredEntry } from "@/features/sync/mirror";
import { emptySyncResult } from "@/features/sync/result";

interface Log {
  saved: string[];
  removed: string[];
}

function bundled(
  log: Log,
  key: string,
  hash: string,
  save: () => Promise<readonly string[]> = () => Promise.resolve([]),
): BundledEntry {
  return {
    key,
    fileName: `${key}.md`,
    hash,
    save: async () => {
      const warnings = await save();
      log.saved.push(key);
      return warnings;
    },
  };
}

function stored(
  log: Log,
  key: string | null,
  sourceHash: string,
  label = key ?? "no-key",
  remove: () => Promise<void> = () => Promise.resolve(),
): StoredEntry {
  return {
    key,
    sourceHash,
    label,
    remove: async () => {
      await remove();
      log.removed.push(label);
    },
  };
}

describe("mirrorBundled", () => {
  it("新しいものは追加、ハッシュが同じなら何もせず、違えば入れ直し、同梱にないものは消す", async () => {
    const log: Log = { saved: [], removed: [] };
    const result = emptySyncResult();
    await mirrorBundled(
      result,
      [bundled(log, "same", "h1"), bundled(log, "changed", "h2"), bundled(log, "new", "h3")],
      [stored(log, "same", "h1"), stored(log, "changed", "old"), stored(log, "gone", "h")],
    );
    expect(result).toEqual({
      ...emptySyncResult(),
      added: 1,
      updated: 1,
      unchanged: 1,
      removed: 1,
    });
    expect(log).toEqual({ saved: ["changed", "new"], removed: ["gone"] });
  });

  it("キーのないものは、いくつあっても全部消す", async () => {
    const log: Log = { saved: [], removed: [] };
    const result = emptySyncResult();
    await mirrorBundled(result, [], [stored(log, null, "h", "a"), stored(log, null, "h", "b")]);
    expect(result.removed).toBe(2);
    expect(log.removed).toEqual(["a", "b"]);
  });

  it("keepKeys にあるものは、同梱の候補になくても消さない", async () => {
    const log: Log = { saved: [], removed: [] };
    const result = emptySyncResult();
    await mirrorBundled(result, [], [stored(log, "rejected", "h")], new Set(["rejected"]));
    expect(result.removed).toBe(0);
    expect(log.removed).toEqual([]);
  });

  it("保存・削除に失敗しても他は続け、保存の警告はファイル名と一緒に積む", async () => {
    const log: Log = { saved: [], removed: [] };
    const result = emptySyncResult();
    result.failed.push({ fileName: "earlier.md", message: "先に積んだもの" });
    await mirrorBundled(
      result,
      [
        bundled(log, "bad", "h", () => Promise.reject(new Error("壊れた"))),
        bundled(log, "warn", "h", () => Promise.resolve(["直すべき点"])),
        bundled(log, "ok", "h"),
      ],
      [
        stored(log, "stuck", "h", "消せない", () => Promise.reject(new Error("使用中"))),
        stored(log, "gone", "h"),
      ],
    );
    expect(result).toEqual({
      ...emptySyncResult(),
      added: 2,
      removed: 1,
      failed: [
        { fileName: "earlier.md", message: "先に積んだもの" },
        { fileName: "bad.md", message: "壊れた" },
        { fileName: "消せない", message: "使用中" },
      ],
      warnings: [{ fileName: "warn.md", message: "直すべき点" }],
    });
    expect(log).toEqual({ saved: ["warn", "ok"], removed: ["gone"] });
  });
});
