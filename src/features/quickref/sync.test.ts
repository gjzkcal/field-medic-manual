import { describe, expect, it } from "vitest";

import type { QuickrefSource } from "@/features/quickref/bundle";
import { syncQuickref, type QuickrefSyncDeps } from "@/features/quickref/sync";
import { emptySyncResult } from "@/features/sync/result";
import type { QuickrefReplaceInput } from "@/lib/bindings/QuickrefReplaceInput";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";

const TEXT = `$schema: ./quickref.v1.schema.json
modChannel: dev
verifiedAt: "2026-09-28"
rows:
  - id: limb-bleeding
    category: 出血
    symptom: 手足から大量に出血している
    severity: 致命的
    treatment: [包帯を巻く]
    items: [包帯]
    links: [doc:hemorrhage.md#包帯を巻く]
`;

function source(text: string, hash: string): QuickrefSource {
  return { fileName: "quickref.yaml", text, hash };
}

function fakeDb(sourceHash: string | null): QuickrefSyncDeps & { saved: QuickrefReplaceInput[] } {
  const saved: QuickrefReplaceInput[] = [];
  const table: QuickrefTable = { sourceHash, modChannel: null, verifiedAt: null, rows: [] };
  return {
    saved,
    listQuickref: () => Promise.resolve(table),
    replaceAll: (input) => {
      saved.push(input);
      return Promise.resolve();
    },
  };
}

describe("syncQuickref", () => {
  it("ハッシュが同じなら何もしない", async () => {
    const db = fakeDb("h1");
    const result = await syncQuickref(source(TEXT, "h1"), db);
    expect(result).toEqual({ ...emptySyncResult(), unchanged: 1 });
    expect(db.saved).toEqual([]);
  });

  it("変わっていれば全行を置き換える", async () => {
    const db = fakeDb("old");
    const result = await syncQuickref(source(TEXT, "h2"), db);
    expect(result).toEqual({ ...emptySyncResult(), updated: 1 });
    expect(db.saved).toHaveLength(1);
    expect(db.saved[0]).toMatchObject({
      sourceHash: "h2",
      modChannel: "dev",
      verifiedAt: "2026-09-28",
      rows: [{ id: "limb-bleeding", severity: 4, items: ["包帯"] }],
    });
  });

  it("まだ一度も同期していなければ入れる", async () => {
    const db = fakeDb(null);
    expect(await syncQuickref(source(TEXT, "h1"), db)).toMatchObject({ added: 1, updated: 0 });
  });

  it("読めない・形が違うときは置き換えず、前の内容を残す", async () => {
    for (const text of ["rows: [", TEXT.replace("致命的", "重篤"), `\uFEFF${TEXT}`]) {
      const db = fakeDb("old");
      const result = await syncQuickref(source(text, "h2"), db);
      expect(result).toMatchObject({ added: 0, updated: 0, unchanged: 0 });
      expect(result.failed.length).toBeGreaterThan(0);
      expect(result.failed[0]?.fileName).toBe("quickref.yaml");
      expect(db.saved).toEqual([]);
    }
  });

  it("DB が受け付けなければ失敗として返す", async () => {
    const db: QuickrefSyncDeps = {
      listQuickref: fakeDb("old").listQuickref,
      replaceAll: () => Promise.reject(new Error("壊れた")),
    };
    const result = await syncQuickref(source(TEXT, "h2"), db);
    expect(result.updated).toBe(0);
    expect(result.failed).toEqual([{ fileName: "quickref.yaml", message: "壊れた" }]);
  });

  it("同梱のファイルがなければ、表を空にする（DB は同梱物の写し）", async () => {
    const db = fakeDb("old");
    const result = await syncQuickref(null, db);
    expect(result.removed).toBe(1);
    expect(db.saved[0]?.rows).toEqual([]);
    const empty = fakeDb(db.saved[0]?.sourceHash ?? "");
    expect((await syncQuickref(null, empty)).unchanged).toBe(1);
  });
});
