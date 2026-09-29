// 起動時に、同梱したクイック表を DB に入れる。
// ファイル 1 つなので、変わっていれば全行を置き換える。読めなければ置き換えず、前回の内容を残す。
import { create } from "zustand";

import type { SyncIssue } from "@/features/content/sync";
import {
  bundledQuickref,
  readQuickrefSource,
  type QuickrefSource,
} from "@/features/quickref/bundle";
import { toQuickrefRows } from "@/features/quickref/schema";
import type { QuickrefReplaceInput } from "@/lib/bindings/QuickrefReplaceInput";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { errorMessage, quickrefList, quickrefReplaceAll } from "@/lib/tauri";

export interface QuickrefSyncResult {
  status: "unchanged" | "replaced" | "failed";
  /** 入れた行の数（置き換えたときだけ） */
  rowCount: number;
  /** 読めなかった・DB が受け付けなかった理由。このときは前回の内容が DB に残る */
  failed: SyncIssue[];
}

/** 同期が DB とやり取りする処理。テストでは差し替える。 */
export interface QuickrefSyncDeps {
  listQuickref: () => Promise<QuickrefTable>;
  replaceAll: (input: QuickrefReplaceInput) => Promise<void>;
}

// 同梱のファイルがないときに記録するハッシュ。sha256 と重ならない値にして、次の起動で「変更なし」と判定させる
const NO_FILE_HASH = "none";

export async function syncQuickref(
  source: QuickrefSource | null,
  deps: QuickrefSyncDeps,
): Promise<QuickrefSyncResult> {
  const current = await deps.listQuickref();
  const hash = source?.hash ?? NO_FILE_HASH;
  if (current.sourceHash === hash) {
    return { status: "unchanged", rowCount: 0, failed: [] };
  }

  let input: QuickrefReplaceInput;
  if (source === null) {
    // DB は同梱物の写しなので、ファイルを消したら表も空にする
    input = { sourceHash: hash, modChannel: null, verifiedAt: null, rows: [] };
  } else {
    const read = await readQuickrefSource(source);
    if (!read.ok) {
      return {
        status: "failed",
        rowCount: 0,
        failed: read.messages.map((message) => ({ fileName: source.fileName, message })),
      };
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
    return {
      status: "failed",
      rowCount: 0,
      failed: [
        {
          fileName: source?.fileName ?? "quickref.yaml",
          message: error instanceof Error ? error.message : errorMessage(error),
        },
      ],
    };
  }
  return { status: "replaced", rowCount: input.rows.length, failed: [] };
}

type QuickrefSyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; result: QuickrefSyncResult }
  | { status: "error"; message: string };

export const useQuickrefSync = create<{ state: QuickrefSyncState }>()(() => ({
  state: { status: "idle" },
}));

/** 同梱したクイック表を DB に入れる。起動時に 1 回呼ぶ。結果は useQuickrefSync で見る。 */
export async function syncBundledQuickref(): Promise<QuickrefSyncResult | null> {
  useQuickrefSync.setState({ state: { status: "syncing" } });
  try {
    const result = await syncQuickref(await bundledQuickref(), {
      listQuickref: quickrefList,
      replaceAll: quickrefReplaceAll,
    });
    useQuickrefSync.setState({ state: { status: "done", result } });
    return result;
  } catch (error: unknown) {
    useQuickrefSync.setState({ state: { status: "error", message: errorMessage(error) } });
    return null;
  }
}
