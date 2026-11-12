// アプリの外（既定のブラウザ）で開いてよい URL。
// 本文のリンクの分類（features/library/link.ts）と、開く関数（tauri.ts / tauri.web.ts）の両方で使い、
// 呼び出し側の検査をすり抜けた javascript: や file: などを、開く直前でも止める（多層防御）
// i と u を一緒に付けると ſ（U+017F）が s に当たり、`httpſ:` も通ってしまう。大文字小文字は文字クラスで書く
const EXTERNAL_URL = /^[Hh][Tt]{2}[Pp][Ss]?:/u;

export function isExternalUrl(url: string): boolean {
  return EXTERNAL_URL.test(url.trim());
}
