// 起動時に、同梱したクイック表を DB に入れる。
// ファイル 1 つなので、変わっていれば全行を置き換える。読めなければ置き換えず、前回の内容を残す。
import {
  bundledQuickref,
  readQuickrefSource,
  type QuickrefSource,
} from "@/features/quickref/bundle";
import { toQuickrefRows } from "@/features/quickref/schema";
import { emptySyncResult, issuesOf, type SyncResult } from "@/features/sync/result";
import { createBundledSync } from "@/features/sync/store";
import type { QuickrefReplaceInput } from "@/lib/bindings/QuickrefReplaceInput";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { errorMessage, quickrefList, quickrefReplaceAll } from "@/lib/tauri";

/** 同期が DB とやり取りする処理。テストでは差し替える。 */
export interface QuickrefSyncDeps {
  listQuickref: () => Promise<QuickrefTable>;
  replaceAll: (input: QuickrefReplaceInput) => Promise<void>;
}

// 同梱のファイルがないときに記録するハッシュ。sha256 と重ならない値にして、次の起動で「変更なし」と判定させる
const NO_FILE_HASH = "none";

/** 件数は、表全体を 1 つのものとして数える（原稿・フローの同期と同じ結果の形で画面に出すため） */
export async function syncQuickref(
  source: QuickrefSource | null,
  deps: QuickrefSyncDeps,
): Promise<SyncResult> {
  const result = emptySyncResult();
  const current = await deps.listQuickref();
  const hash = source?.hash ?? NO_FILE_HASH;
  if (current.sourceHash === hash) {
    result.unchanged++;
    return result;
  }

  let input: QuickrefReplaceInput;
  if (source === null) {
    // DB は同梱物の写しなので、ファイルを消したら表も空にする
    input = { sourceHash: hash, modChannel: null, verifiedAt: null, rows: [] };
  } else {
    const read = await readQuickrefSource(source);
    if (!read.ok) {
      result.failed.push(...issuesOf(source.fileName, read.messages));
      return result;
    }
    input = {
      sourceHash: hash,
      modChannel: read.file.modChannel ?? null,
      verifiedAt: read.file.verifiedAt,
      rows: toQuickrefRows(read.file),
    };
  }
  try {
    await deps.replaceAll(input);
  } catch (error: unknown) {
    result.failed.push({
      fileName: source?.fileName ?? "quickref.yaml",
      message: errorMessage(error),
    });
    return result;
  }
  if (source === null) {
    // 一度も同期していなければ、消したものはない
    if (current.sourceHash !== null) {
      result.removed++;
    }
  } else if (current.sourceHash === null) {
    result.added++;
  } else {
    result.updated++;
  }
  return result;
}

/** 同梱したクイック表を DB に入れる。起動時に 1 回呼ぶ。結果は useQuickrefSync で見る。 */
export const { useSync: useQuickrefSync, sync: syncBundledQuickref } = createBundledSync(async () =>
  syncQuickref(await bundledQuickref(), {
    listQuickref: quickrefList,
    replaceAll: quickrefReplaceAll,
  }),
);
