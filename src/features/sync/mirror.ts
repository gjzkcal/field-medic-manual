// DB を同梱物の写しにする共通の手順。ハッシュで比べて変わったものだけ入れ直し、同梱にないものは消す。
// 何をどう保存・削除するかは呼ぶ側が渡す。
import type { SyncResult } from "@/features/sync/result";
import { errorMessage } from "@/lib/tauri";

/** 同梱にあって、DB に入れる候補 */
export interface BundledEntry {
  /** DB に入っている同じものを探すキー */
  key: string;
  /** 問題を知らせるときに出す名前 */
  fileName: string;
  hash: string;
  /** DB に入れる。返した文言は警告として結果に積む */
  save: () => Promise<readonly string[]>;
}

/** DB に入っているもの */
export interface StoredEntry {
  /** 同梱物と対応しないもの（手で入れたものなど）は null */
  key: string | null;
  sourceHash: string | null;
  /** 消せなかったときに出す名前 */
  label: string;
  remove: () => Promise<void>;
}

/**
 * 結果は result に積む（呼ぶ側が先に読み込みや検証の問題を積んでいるため）。
 * keepKeys: 同梱にはあるが今回は入れなかったもの。消すと前回の内容まで失うので残す。
 */
export async function mirrorBundled(
  result: SyncResult,
  entries: readonly BundledEntry[],
  stored: readonly StoredEntry[],
  keepKeys: ReadonlySet<string> = new Set(),
): Promise<void> {
  const byKey = new Map<string, StoredEntry>();
  for (const entry of stored) {
    if (entry.key !== null) {
      byKey.set(entry.key, entry);
    }
  }

  for (const entry of entries) {
    const current = byKey.get(entry.key);
    if (current?.sourceHash === entry.hash) {
      result.unchanged++;
      continue;
    }
    try {
      const warnings = await entry.save();
      result.warnings.push(...warnings.map((message) => ({ fileName: entry.fileName, message })));
      if (current === undefined) {
        result.added++;
      } else {
        result.updated++;
      }
    } catch (error: unknown) {
      // 1 つの誤りで他の更新を止めない
      result.failed.push({ fileName: entry.fileName, message: errorMessage(error) });
    }
  }

  const bundledKeys = new Set(entries.map((e) => e.key));
  for (const entry of stored) {
    if (entry.key !== null && (bundledKeys.has(entry.key) || keepKeys.has(entry.key))) {
      continue;
    }
    try {
      await entry.remove();
      result.removed++;
    } catch (error: unknown) {
      result.failed.push({ fileName: entry.label, message: errorMessage(error) });
    }
  }
}
