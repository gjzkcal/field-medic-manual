// 起動時に、同梱した原稿を DB に入れる（dev-docs/reference/bundled-content.md §3）。
// DB の本文は同梱物の写しなので、変わった原稿だけ入れ直し、同梱にないドキュメントは消す。
import { create } from "zustand";

import { bundledManuals, readBundledImage } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { manualSourcePath } from "@/features/content/path";
import { saveDocument } from "@/features/content/save";
import type { ManualSource, NormalizedDoc, ReadImage } from "@/features/content/types";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import { docDelete, docList, errorMessage } from "@/lib/tauri";

export interface SyncIssue {
  fileName: string;
  message: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** 保存できなかった原稿。前回の内容が DB に残る */
  failed: SyncIssue[];
  /** 保存はしたが、原稿に直すべき点がある */
  warnings: SyncIssue[];
}

/** 同期が DB とやり取りする処理。テストでは差し替える。 */
export interface SyncDeps {
  listDocs: () => Promise<DocSummary[]>;
  saveDoc: (doc: NormalizedDoc) => Promise<string>;
  deleteDoc: (id: string) => Promise<void>;
  readImage: ReadImage;
}

const RETRY_SUFFIX = ":retry";

export async function syncManuals(
  manuals: readonly ManualSource[],
  deps: SyncDeps,
): Promise<SyncResult> {
  const result: SyncResult = {
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    failed: [],
    warnings: [],
  };
  const existing = new Map((await deps.listDocs()).map((d) => [d.sourcePath, d]));
  const bundledPaths = new Set<string>();

  for (const manual of manuals) {
    const sourcePath = manualSourcePath(manual.fileName);
    bundledPaths.add(sourcePath);
    const current = existing.get(sourcePath);
    if (current?.sourceHash === manual.hash) {
      result.unchanged++;
      continue;
    }
    try {
      const { doc, warnings } = await convertManual(manual, deps.readImage);
      // 警告のある原稿（画像を読めなかったなど）は一部を欠いたまま保存される。ハッシュを変えて保存し、
      // 次の起動で入れ直させる（原稿が同じだと「変更なし」になり、欠けたままになるため）
      await deps.saveDoc(
        warnings.length === 0 ? doc : { ...doc, sourceHash: `${doc.sourceHash}${RETRY_SUFFIX}` },
      );
      result.warnings.push(...warnings.map((message) => ({ fileName: manual.fileName, message })));
      if (current === undefined) {
        result.added++;
      } else {
        result.updated++;
      }
    } catch (error: unknown) {
      // 1 つの原稿の誤りで他の原稿の更新を止めない
      result.failed.push({ fileName: manual.fileName, message: describeError(error) });
    }
  }

  // 同梱にないもの（消した原稿、開発中に入れたものなど）を消す。DB を同梱物と一致させるため
  for (const [sourcePath, doc] of existing) {
    if (sourcePath === null || !bundledPaths.has(sourcePath)) {
      try {
        await deps.deleteDoc(doc.id);
        result.removed++;
      } catch (error: unknown) {
        result.failed.push({ fileName: doc.title, message: describeError(error) });
      }
    }
  }
  return result;
}

type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; result: SyncResult }
  | { status: "error"; message: string };

export const useContentSync = create<{ state: SyncState }>()(() => ({
  state: { status: "idle" },
}));

/** 同梱した原稿を DB に入れる。起動時に 1 回呼ぶ（デバッグ画面からも呼べる）。結果は useContentSync で見る。 */
export async function syncBundledManuals(): Promise<SyncResult | null> {
  useContentSync.setState({ state: { status: "syncing" } });
  try {
    const result = await syncManuals(await bundledManuals(), {
      listDocs: docList,
      saveDoc: saveDocument,
      deleteDoc: docDelete,
      readImage: readBundledImage,
    });
    useContentSync.setState({ state: { status: "done", result } });
    return result;
  } catch (error: unknown) {
    useContentSync.setState({ state: { status: "error", message: errorMessage(error) } });
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : errorMessage(error);
}
