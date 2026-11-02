// 過量投与の線。起動時に読む表示設定からも使うので、zod を連れてくる schema.ts とは分ける
export const OVERDOSE_LINES = ["unconscious", "arrest"] as const;
export type OverdoseLine = (typeof OVERDOSE_LINES)[number];
