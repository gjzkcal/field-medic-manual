// 起動時に、同梱した原稿を DB に入れる。
// DB の本文は同梱物の写しなので、変わった原稿だけ入れ直し、同梱にないドキュメントは消す。
import { bundledManuals, readBundledImage } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { manualSourcePath } from "@/features/content/path";
import { saveDocument } from "@/features/content/save";
import type { ManualSource, NormalizedDoc, ReadImage } from "@/features/content/types";
import { mirrorBundled } from "@/features/sync/mirror";
import { emptySyncResult, type SyncResult } from "@/features/sync/result";
import { createBundledSync } from "@/features/sync/store";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import { docDelete, docList } from "@/lib/tauri";

/** 同期が DB とやり取りする処理。テストでは差し替える。 */
export interface ManualSyncDeps {
  listDocs: () => Promise<DocSummary[]>;
  saveDoc: (doc: NormalizedDoc) => Promise<string>;
  deleteDoc: (id: string) => Promise<void>;
  readImage: ReadImage;
}

const RETRY_SUFFIX = ":retry";

export async function syncManuals(
  manuals: readonly ManualSource[],
  deps: ManualSyncDeps,
): Promise<SyncResult> {
  const result = emptySyncResult();
  await mirrorBundled(
    result,
    manuals.map((manual) => ({
      key: manualSourcePath(manual.fileName),
      fileName: manual.fileName,
      hash: manual.hash,
      save: async () => {
        const { doc, warnings } = await convertManual(manual, deps.readImage);
        // 警告のある原稿（画像を読めなかったなど）は一部を欠いたまま保存される。ハッシュを変えて保存し、
        // 次の起動で入れ直させる（原稿が同じだと「変更なし」になり、欠けたままになるため）
        await deps.saveDoc(
          warnings.length === 0 ? doc : { ...doc, sourceHash: `${doc.sourceHash}${RETRY_SUFFIX}` },
        );
        return warnings;
      },
    })),
    // source_path のないもの・同梱にないもの（消した原稿、開発中に入れたものなど）は消える
    (await deps.listDocs()).map((doc) => ({
      key: doc.sourcePath,
      sourceHash: doc.sourceHash,
      label: doc.title,
      remove: () => deps.deleteDoc(doc.id),
    })),
  );
  return result;
}

/** 同梱した原稿を DB に入れる。起動時に 1 回呼ぶ（デバッグ画面からも呼べる）。結果は useContentSync で見る。 */
export const { useSync: useContentSync, sync: syncBundledManuals } = createBundledSync(
  async () =>
    syncManuals(await bundledManuals(), {
      listDocs: docList,
      saveDoc: saveDocument,
      deleteDoc: docDelete,
      readImage: readBundledImage,
    }),
);
