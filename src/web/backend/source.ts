// Web 版の画面が原稿・クイック表・フローを読む口。src/lib/tauri.web.ts がこれを通して返す。
// 本番は、ビルドのときに分けた部分（prebuilt.ts）を、要るものだけ取りに行く。
// 開発サーバーとテストは、その場で変換した 1 つの表（load.ts）から同じ形で返す。
import type { NormalizedAsset } from "@/features/content/types";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { decodeAsset, type PartLoaders, type PrebuiltIndex } from "@/web/backend/prebuilt";
import {
  findDoc,
  listDocs,
  outlineDocs,
  tagCounts,
  type WebFlow,
  type WebStore,
} from "@/web/backend/store";

export interface WebSource {
  index: () => Promise<PrebuiltIndex>;
  /** 無い id は undefined */
  doc: (id: string) => Promise<DocDetail | undefined>;
  /** 画像。その画像を持つ原稿を doc で読んだ後でないと見つからない（画面は本文を開いてから画像を読む） */
  asset: (id: string) => NormalizedAsset | undefined;
  quickref: () => Promise<QuickrefTable>;
  flows: () => Promise<readonly WebFlow[]>;
  /** 検索に渡す表。docs の節は HTML を持たないことがある */
  searchStore: () => Promise<WebStore>;
}

export function sourceFromStore(store: WebStore): WebSource {
  const index: PrebuiltIndex = {
    docs: listDocs(store),
    outline: outlineDocs(store),
    tags: tagCounts(store),
  };
  return {
    index: () => Promise.resolve(index),
    doc: (id) => Promise.resolve(findDoc(store, id)),
    asset: (id) => store.assets.get(id),
    quickref: () => Promise.resolve(store.quickref),
    flows: () => Promise.resolve(store.flows),
    searchStore: () => Promise.resolve(store),
  };
}

/**
 * 最初に呼ばれたときに 1 回だけ読む。失敗は覚えたままにせず、次に呼ばれたらやり直す
 * （回線が切れていたときに、再読み込みのボタンなどで読み直せるように）
 */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

export function sourceFromParts(loaders: PartLoaders): WebSource {
  const assets = new Map<string, NormalizedAsset>();
  const docs = new Map<string, () => Promise<DocDetail>>();
  const quickref = once(async () => (await loaders.quickref()).default);
  const flows = once(async () => (await loaders.flows()).default);

  function docLoader(id: string): (() => Promise<DocDetail>) | undefined {
    // id は URL から来る。constructor のような、表が元から持つ名前を原稿として読まない
    const load = Object.hasOwn(loaders.docs, id) ? loaders.docs[id] : undefined;
    if (load === undefined) {
      return undefined;
    }
    let loader = docs.get(id);
    if (loader === undefined) {
      loader = once(async () => {
        const part = (await load()).default;
        for (const asset of part.assets) {
          assets.set(asset.id, decodeAsset(asset));
        }
        return part.detail;
      });
      docs.set(id, loader);
    }
    return loader;
  }

  return {
    index: once(async () => (await loaders.index()).default),
    doc: (id) => docLoader(id)?.() ?? Promise.resolve(undefined),
    asset: (id) => assets.get(id),
    quickref,
    flows,
    searchStore: once(async () => {
      const [search, table, flowList] = await Promise.all([loaders.search(), quickref(), flows()]);
      return { docs: search.default, quickref: table, flows: flowList, assets };
    }),
  };
}
