// アプリの外（既定のブラウザ）で開いてよい URL。
// 本文のリンクの分類（features/library/link.ts）と、開く関数（tauri.ts / tauri.web.ts）の両方で使い、
// 呼び出し側の検査をすり抜けた javascript: や file: などを、開く直前でも止める（多層防御）
const EXTERNAL_URL = /^https?:/i;

export function isExternalUrl(url: string): boolean {
  return EXTERNAL_URL.test(url.trim());
}
