import { describe, expect, it } from "vitest";

import type { NormalizedAsset, NormalizedDoc } from "@/features/content/types";
import { bleeding, cpr, doc, EMPTY_QUICKREF, section, tourniquet } from "@/test/web-fixtures";
import { buildStore, findDoc, listDocs, outlineDocs, tagCounts } from "@/web/backend/store";

const NOW = "2026-10-11T00:00:00.000Z";

describe("buildStore", () => {
  it("文書の id をファイル名（拡張子なし）にし、節の id を文書をまたいで一意にする", () => {
    const store = buildStore([tourniquet(), bleeding()], EMPTY_QUICKREF, NOW);
    expect(listDocs(store).map((d) => d.id)).toEqual(["bleeding", "tourniquet"]);
    const ids = store.docs.flatMap((d) => d.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("同じファイル名の原稿が 2 つあれば失敗する", () => {
    expect(() => buildStore([bleeding(), bleeding()], EMPTY_QUICKREF, NOW)).toThrow();
  });

  it("見出しのレベルから親を決める。導入部は親を持たず、親にもならない", () => {
    const d = doc(
      "構造",
      "structure.md",
      null,
      null,
      [],
      [
        section(0, "", "intro", "導入"),
        section(1, "A", "a", "a"),
        section(2, "A-1", "a-1", "a1"),
        section(3, "A-1-x", "a-1-x", "x"),
        section(2, "A-2", "a-2", "a2"),
        section(1, "B", "b", "b"),
      ],
    );
    const detail = findDoc(buildStore([d], EMPTY_QUICKREF, NOW), "structure");
    const parent = (anchor: string): string | undefined => {
      const id = detail?.sections.find((s) => s.anchor === anchor)?.parentId;
      return detail?.sections.find((s) => s.id === id)?.anchor;
    };
    expect(parent("intro")).toBeUndefined();
    expect(parent("a")).toBeUndefined();
    expect(parent("a-1")).toBe("a");
    expect(parent("a-1-x")).toBe("a-1");
    expect(parent("a-2")).toBe("a");
    expect(parent("b")).toBeUndefined();
    expect(detail?.sections.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("一覧は order のある文書を先に、order、タイトルの順に並べる", () => {
    const ordered = (title: string, file: string, order: number | null): NormalizedDoc => {
      const d = doc(title, file, null, null, [], [section(1, title, "h", "本文")]);
      d.meta.order = order;
      return d;
    };
    const store = buildStore(
      [
        ordered("b", "b.md", null),
        ordered("A", "a.md", null),
        ordered("z", "z.md", 20),
        ordered("y", "y.md", 10),
      ],
      EMPTY_QUICKREF,
      NOW,
    );
    expect(listDocs(store).map((d) => d.title)).toEqual(["y", "z", "A", "b"]);
    expect(outlineDocs(store).map((d) => d.title)).toEqual(["y", "z", "A", "b"]);
  });

  it("見出しの一覧は h1〜h3 だけで、本文の有無を持つ", () => {
    const d = doc(
      "見出し",
      "outline.md",
      null,
      null,
      [],
      [
        section(0, "", "intro", "導入"),
        section(1, "一", "h1", ""),
        section(3, "三", "h3", "本文"),
        section(4, "四", "h4", "本文"),
      ],
    );
    const [outline] = outlineDocs(buildStore([d], EMPTY_QUICKREF, NOW));
    expect(outline?.headings.map((h) => [h.anchor, h.hasBody])).toEqual([
      ["h1", false],
      ["h3", true],
    ]);
  });

  it("文書と節のタグを正規化して名前順にし、使われた数を数える", () => {
    const d = doc(
      "タグ",
      "tags.md",
      null,
      null,
      ["#b", "A", "a"],
      [section(1, "見出し", "h", "本文", ["B", "c"])],
    );
    const store = buildStore([d, bleeding()], EMPTY_QUICKREF, NOW);
    const detail = findDoc(store, "tags");
    expect(detail?.meta.tags).toEqual(["A", "b"]);
    // 表記は最初に出てきたもの（文書の「b」）にそろえる
    expect(detail?.sections[0]?.tags).toEqual(["b", "c"]);
    expect(tagCounts(store)).toContainEqual({ name: "b", documentCount: 1, sectionCount: 1 });
    expect(tagCounts(store)).toContainEqual({
      name: "圧迫止血",
      documentCount: 0,
      sectionCount: 1,
    });
  });

  it("メタデータの空文字を null にし、コミットを小文字にする", () => {
    const d = cpr();
    d.meta.aceCommit = " ABCDEF1 ";
    d.meta.category = " ";
    const detail = findDoc(buildStore([d], EMPTY_QUICKREF, NOW), "cpr");
    expect(detail?.meta.aceCommit).toBe("abcdef1");
    expect(detail?.meta.category).toBeNull();
    expect(detail?.meta.modVersion).toBe("1.5.36");
  });

  it("画像を id で引けるようにし、文書には大きさなどだけを載せる", () => {
    const asset: NormalizedAsset = {
      id: "a".repeat(64),
      fileName: "fig.png",
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    };
    const d = tourniquet();
    d.assets.push(asset);
    const store = buildStore([d], EMPTY_QUICKREF, NOW);
    expect(store.assets.get(asset.id)).toBe(asset);
    expect(findDoc(store, "tourniquet")?.assets).toEqual([
      { id: asset.id, mime: "image/png", fileName: "fig.png", size: 3 },
    ]);
  });
});
