import { describe, expect, it } from "vitest";

import { syncManuals, type SyncDeps } from "@/features/content/sync";
import type { ManualSource, NormalizedDoc } from "@/features/content/types";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import { noImages } from "@/test/samples";

function manual(fileName: string, hash: string, text = "# 見出し\n本文"): ManualSource {
  return { fileName, path: `/content/manuals/${fileName}`, text, hash };
}

function summary(id: string, sourcePath: string | null, sourceHash: string): DocSummary {
  return {
    id,
    title: id,
    sourceType: "markdown",
    sourcePath,
    sourceHash,
    meta: { modTarget: null, modChannel: null, modVersion: null, verifiedAt: null, tags: [] },
    sectionCount: 1,
    createdAt: "",
    updatedAt: "",
  };
}

/** DB の代わり。保存と削除を記録する。 */
function fakeDb(docs: DocSummary[]): SyncDeps & { saved: NormalizedDoc[]; deleted: string[] } {
  const saved: NormalizedDoc[] = [];
  const deleted: string[] = [];
  return {
    saved,
    deleted,
    listDocs: () => Promise.resolve(docs),
    saveDoc: (doc) => {
      saved.push(doc);
      return Promise.resolve("id");
    },
    deleteDoc: (id) => {
      deleted.push(id);
      return Promise.resolve();
    },
    readImage: noImages,
  };
}

describe("syncManuals", () => {
  it("新しい原稿は追加し、ハッシュが同じなら何もせず、違えば入れ直す", async () => {
    const db = fakeDb([
      summary("same", "bundle://manuals/same.md", "h1"),
      summary("changed", "bundle://manuals/changed.md", "old"),
    ]);
    const result = await syncManuals(
      [manual("same.md", "h1"), manual("changed.md", "h2"), manual("new.md", "h3")],
      db,
    );

    expect(result).toMatchObject({ added: 1, updated: 1, unchanged: 1, removed: 0, failed: [] });
    expect(db.saved.map((d) => [d.sourcePath, d.sourceHash])).toEqual([
      ["bundle://manuals/changed.md", "h2"],
      ["bundle://manuals/new.md", "h3"],
    ]);
  });

  it("同梱にないドキュメント（消した原稿、source_path のないもの、開発中に入れたもの）は消す", async () => {
    const db = fakeDb([
      summary("kept", "bundle://manuals/kept.md", "h"),
      summary("gone", "bundle://manuals/gone.md", "h"),
      summary("sample", "sample://cpr", "h"),
      summary("nopath", null, "h"),
    ]);
    const result = await syncManuals([manual("kept.md", "h")], db);

    expect(result.removed).toBe(3);
    expect(db.deleted).toEqual(["gone", "sample", "nopath"]);
  });

  it("保存に失敗した原稿があっても他の原稿は続け、警告は原稿ごとに返す", async () => {
    const db = fakeDb([]);
    const failing: SyncDeps = {
      ...db,
      saveDoc: (doc) =>
        doc.sourcePath.endsWith("bad.md") ? Promise.reject(new Error("壊れた")) : db.saveDoc(doc),
    };
    const result = await syncManuals(
      [manual("bad.md", "h"), manual("warn.md", "h", "---\nmod: medic\n---\n# A"), manual("ok.md", "h")],
      failing,
    );

    expect(result.failed).toEqual([{ fileName: "bad.md", message: "壊れた" }]);
    expect(result.added).toBe(2);
    expect(result.warnings).toEqual([
      { fileName: "warn.md", message: expect.stringContaining("mod の値が不明です") as unknown },
    ]);
  });

  it("警告のあった原稿は、次の同期で入れ直す（画像を読めなかったときに欠けたまま残さないため）", async () => {
    const withImage = manual("img.md", "h", "# A\n![図](images/none.png)");
    const db = fakeDb([]);
    await syncManuals([withImage], db);
    const saved = db.saved[0];
    expect(saved?.sourceHash).not.toBe("h");

    const next = fakeDb([summary("img", "bundle://manuals/img.md", saved?.sourceHash ?? "")]);
    const result = await syncManuals([withImage], next);
    expect(result).toMatchObject({ updated: 1, unchanged: 0 });
  });
});
