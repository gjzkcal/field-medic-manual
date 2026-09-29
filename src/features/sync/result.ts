// 起動時に同梱物（原稿・フロー・クイック表）を DB に入れた結果。3 つの同期で同じ形にし、表示を共通にする。

export interface SyncIssue {
  fileName: string;
  message: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** DB に入れられなかったもの。前回の内容が DB に残る */
  failed: SyncIssue[];
  /** 入れたが、原稿に直すべき点がある */
  warnings: SyncIssue[];
}

export function emptySyncResult(): SyncResult {
  return { added: 0, updated: 0, unchanged: 0, removed: 0, failed: [], warnings: [] };
}

export function issuesOf(fileName: string, messages: readonly string[]): SyncIssue[] {
  return messages.map((message) => ({ fileName, message }));
}
