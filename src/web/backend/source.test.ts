import { describe, expect, it } from "vitest";

import type { NormalizedAsset } from "@/features/content/types";
import { CONVERT_TIMEOUT_MS } from "@/test/samples";
import { bleeding, cpr, EMPTY_QUICKREF } from "@/test/web-fixtures";
import { loadWebStore } from "@/web/backend/load";
import { toPrebuiltParts, type PartLoaders, type PrebuiltParts } from "@/web/backend/prebuilt";
import { searchStore } from "@/web/backend/search";
import { sourceFromParts, sourceFromStore, type WebSource } from "@/web/backend/source";
import { buildStore, listDocs, type WebStore } from "@/web/backend/store";

/** 同梱するときと同じく JSON の文字列を通してから、部分ごとに読む関数の表にする */
function loadersOf(store: WebStore): PartLoaders {
  const built = toPrebuiltParts(store);
  const json = JSON.stringify(built);
  expect(JSON.parse(json)).toStrictEqual(built);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- すぐ上で、JSON を通しても同じ形に戻ることを確かめた
  const parts = JSON.parse(json) as PrebuiltParts;
  return {
    index: () => Promise.resolve({ default: parts.index }),
    docs: Object.fromEntries(
      Object.entries(parts.docs).map(([id, doc]) => [id, () => Promise.resolve({ default: doc })]),
    ),
    quickref: () => Promise.resolve({ default: parts.quickref }),
    flows: () => Promise.resolve({ default: parts.flows }),
    search: () => Promise.resolve({ default: parts.search }),
  };
}

/** 読みに行った部分の名前を、読んだ順に calls へ残す */
function recording(loaders: PartLoaders, calls: string[]): PartLoaders {
  function record<T>(name: string, load: () => Promise<T>): () => Promise<T> {
    return () => {
      calls.push(name);
      return load();
    };
  }
  return {
    index: record("index", loaders.index),
    docs: Object.fromEntries(
      Object.entries(loaders.docs).map(([id, load]) => [id, record(`doc:${id}`, load)]),
    ),
    quickref: record("quickref", loaders.quickref),
    flows: record("flows", loaders.flows),
    search: record("search", loaders.search),
  };
}

function firstDocId(store: WebStore): string {
  const [first] = listDocs(store);
  if (first === undefined) {
    throw new Error("原稿が 1 本も無い");
  }
  return first.id;
}

async function search(source: WebSource, query: string, tags?: string[]): Promise<unknown> {
  return searchStore(await source.searchStore(), query, {
    limit: 100,
    ...(tags === undefined ? {} : { filter: { tags } }),
  });
}

describe("分けて同梱した原稿の表", () => {
  it(
    "同梱の原稿・クイック表・フローは、分けて読んでも、分けずに読んだときと同じ答えになる",
    { timeout: CONVERT_TIMEOUT_MS * 2 },
    async () => {
      const store = await loadWebStore();
      const whole = sourceFromStore(store);
      const split = sourceFromParts(loadersOf(store));

      const index = await whole.index();
      expect(await split.index()).toStrictEqual(index);
      expect(index.docs.length).toBeGreaterThan(0);
      for (const { id } of index.docs) {
        expect(await split.doc(id)).toStrictEqual(await whole.doc(id));
      }
      expect(await split.quickref()).toStrictEqual(await whole.quickref());
      expect(await split.flows()).toStrictEqual(await whole.flows());

      // 検索は HTML を除いた節で探す。語・同義語・2 文字の語・絞り込みのどれでも結果が変わらないこと
      const tag = index.tags[0]?.name;
      for (const query of ["TQ", "止血帯", "血", "モルヒネ 痛み", "CPR"]) {
        expect(await search(split, query)).toStrictEqual(await search(whole, query));
      }
      expect(tag).toBeDefined();
      expect(await search(split, "血", tag === undefined ? [] : [tag])).toStrictEqual(
        await search(whole, "血", tag === undefined ? [] : [tag]),
      );
      expect(await search(whole, "止血帯")).not.toStrictEqual([]);
    },
  );

  it("画像の中身（0〜255 のバイト）は、その原稿を読んだ後にそのまま戻る", async () => {
    const asset: NormalizedAsset = {
      id: "a".repeat(64),
      fileName: "a.png",
      mime: "image/png",
      bytes: Uint8Array.from({ length: 256 }, (_, i) => i),
    };
    const store = buildStore(
      [{ ...bleeding(), assets: [asset] }],
      EMPTY_QUICKREF,
      "2026-10-16T00:00:00.000Z",
    );
    const source = sourceFromParts(loadersOf(store));
    expect(source.asset(asset.id)).toBeUndefined();
    const [doc] = (await source.index()).docs;
    await source.doc(doc?.id ?? "");
    expect(source.asset(asset.id)).toStrictEqual(asset);
  });

  it("無い id と、表が元から持つ名前（constructor など）は、原稿として読まない", async () => {
    const store = buildStore([bleeding()], EMPTY_QUICKREF, "2026-10-16T00:00:00.000Z");
    const source = sourceFromParts(loadersOf(store));
    expect(await source.doc("no-such-manual")).toBeUndefined();
    expect(await source.doc("constructor")).toBeUndefined();
    expect(await source.doc("__proto__")).toBeUndefined();
  });

  it("呼ばれた部分だけを読む", async () => {
    const store = buildStore([bleeding(), cpr()], EMPTY_QUICKREF, "2026-10-16T00:00:00.000Z");
    const first = firstDocId(store);
    expect(listDocs(store)).toHaveLength(2);

    const calls: string[] = [];
    const source = sourceFromParts(recording(loadersOf(store), calls));
    expect(calls).toStrictEqual([]);

    await source.index();
    expect(calls).toStrictEqual(["index"]);

    await source.doc(first);
    expect(calls).toStrictEqual(["index", `doc:${first}`]);

    await source.doc("no-such-manual");
    expect(calls).toStrictEqual(["index", `doc:${first}`]);

    calls.length = 0;
    await source.searchStore();
    expect(calls.toSorted()).toStrictEqual(["flows", "quickref", "search"]);
  });

  it("同時に呼ばれても、繰り返し呼ばれても、各部分を 1 回しか読まない", async () => {
    const store = buildStore([bleeding(), cpr()], EMPTY_QUICKREF, "2026-10-16T00:00:00.000Z");
    const first = firstDocId(store);
    const calls: string[] = [];
    const source = sourceFromParts(recording(loadersOf(store), calls));

    await Promise.all([
      source.index(),
      source.index(),
      source.doc(first),
      source.doc(first),
      source.quickref(),
      source.flows(),
      source.searchStore(),
      source.searchStore(),
    ]);
    await Promise.all([source.index(), source.doc(first), source.searchStore()]);

    // 検索の表は、クイック表とフローを画面と共有する（別に読み直さない）
    expect(calls.toSorted()).toStrictEqual(
      [`doc:${first}`, "flows", "index", "quickref", "search"].toSorted(),
    );
  });

  it("読むのに失敗しても覚えたままにせず、次に呼ばれたら読み直す", async () => {
    const store = buildStore([bleeding()], EMPTY_QUICKREF, "2026-10-16T00:00:00.000Z");
    const loaders = loadersOf(store);
    let calls = 0;
    const source = sourceFromParts({
      ...loaders,
      index: () => {
        calls++;
        return calls === 1 ? Promise.reject(new Error("offline")) : loaders.index();
      },
    });
    await expect(source.index()).rejects.toThrow("offline");
    expect((await source.index()).docs).toHaveLength(1);
    // 読めた後は、もう取りに行かない
    await source.index();
    expect(calls).toBe(2);
  });
});
