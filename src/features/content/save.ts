import type { NormalizedDoc } from "@/features/content/types";
import type { DocUpsertInput } from "@/lib/bindings/DocUpsertInput";
import { assetPut, docUpsert } from "@/lib/tauri";

/**
 * 変換した原稿を保存し、id を返す。
 * アセットを先に asset_put してから、bytes を含まない DocUpsertInput で doc_upsert する（大きなバイナリを JSON に載せないため）。
 */
export async function saveDocument(doc: NormalizedDoc): Promise<string> {
  for (const asset of doc.assets) {
    const id = await assetPut(asset.bytes, { fileName: asset.fileName, mime: asset.mime });
    // 本文の data-asset-id は TS で計算した値なので、Rust の計算と食い違うと画像が表示できなくなる
    if (id !== asset.id) {
      throw new Error(`アセットの id が一致しません: ${asset.fileName}`);
    }
  }
  return docUpsert(toUpsertInput(doc));
}

export function toUpsertInput(doc: NormalizedDoc): DocUpsertInput {
  return {
    title: doc.title,
    sourceType: doc.sourceType,
    sourcePath: doc.sourcePath,
    sourceHash: doc.sourceHash,
    meta: doc.meta,
    sections: doc.sections.map((s) => ({
      level: s.level,
      title: s.title,
      anchor: s.anchor,
      html: s.html,
      plainText: s.plainText,
      page: null,
      tags: s.tags,
    })),
    assetIds: doc.assets.map((a) => a.id),
    originalAssetId: null,
  };
}
