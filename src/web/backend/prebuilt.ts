// ビルドのときに変換した原稿の表（WebStore）を、開いた画面に要る分だけ読めるように分けて同梱する形。
// 1 つにまとめると、どの画面を開いても全部の原稿の本文を読むことになり、スマホの回線では表示までの時間の大半を占めた。
// 変換のコードを読まずに使えるよう、このファイルは変換（load.ts）を import しない。
import type { NormalizedAsset } from "@/features/content/types";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import type { TagCount } from "@/lib/bindings/TagCount";
import { listDocs, outlineDocs, tagCounts, type WebFlow, type WebStore } from "@/web/backend/store";

export interface PrebuiltAsset {
  id: string;
  fileName: string;
  mime: string;
  /** 中身の base64 */
  base64: string;
}

/** 一覧・見出しのツリー・タグの数。本文を持たないので小さく、ほとんどの画面が最初に読む */
export interface PrebuiltIndex {
  docs: DocSummary[];
  outline: DocOutline[];
  tags: TagCount[];
}

/** 原稿 1 本の本文と、その原稿の画像 */
export interface PrebuiltDoc {
  detail: DocDetail;
  assets: PrebuiltAsset[];
}

export interface PrebuiltParts {
  index: PrebuiltIndex;
  /** 文書の id ごと */
  docs: Record<string, PrebuiltDoc>;
  quickref: QuickrefTable;
  flows: WebFlow[];
  /** 検索で探す文。全部の原稿の節（HTML を除く）。検索を使うまで読まない */
  search: DocDetail[];
}

interface Part<T> {
  default: T;
}

/**
 * 分けた部分を読む関数の表（vite.config.ts のプラグインが作る virtual:web-store）。
 * それぞれが別のファイルになり、呼んだときに初めて取りに行く
 */
export interface PartLoaders {
  index: () => Promise<Part<PrebuiltIndex>>;
  docs: Readonly<Record<string, () => Promise<Part<PrebuiltDoc>>>>;
  quickref: () => Promise<Part<QuickrefTable>>;
  flows: () => Promise<Part<WebFlow[]>>;
  search: () => Promise<Part<DocDetail[]>>;
}

export function toPrebuiltParts(store: WebStore): PrebuiltParts {
  return {
    index: { docs: listDocs(store), outline: outlineDocs(store), tags: tagCounts(store) },
    docs: Object.fromEntries(
      store.docs.map((detail): [string, PrebuiltDoc] => [
        detail.id,
        {
          detail,
          assets: detail.assets.flatMap(({ id }) => {
            const asset = store.assets.get(id);
            return asset === undefined ? [] : [encodeAsset(asset)];
          }),
        },
      ]),
    ),
    quickref: store.quickref,
    flows: [...store.flows],
    search: store.docs.map(withoutHtml),
  };
}

/** 検索は節の表題・タグ・本文の文字だけを見る。HTML を除くと、検索のために読む量が半分以下になる */
function withoutHtml(doc: DocDetail): DocDetail {
  return { ...doc, sections: doc.sections.map((section) => ({ ...section, html: "" })) };
}

function encodeAsset(asset: NormalizedAsset): PrebuiltAsset {
  return {
    id: asset.id,
    fileName: asset.fileName,
    mime: asset.mime,
    base64: bytesToBase64(asset.bytes),
  };
}

export function decodeAsset(asset: PrebuiltAsset): NormalizedAsset {
  return {
    id: asset.id,
    fileName: asset.fileName,
    mime: asset.mime,
    bytes: base64ToBytes(asset.base64),
  };
}

// Uint8Array.toBase64 / fromBase64 は対応するブラウザがまだ新しいので、どこでもある btoa / atob を使う
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}
