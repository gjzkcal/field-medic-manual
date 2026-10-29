// ページの表題（WCAG 2.4.2）。画面のフックと、Web 版のビルドでルートごとの HTML に埋める処理（vite.config.ts）で共有する。
// vite.config.ts から読むので、React や @/ の別名を使わない

export const APP_NAME = "Field Medic Manual";

/** 画面の名前を先に置く（タブやウィンドウの一覧で、どの画面かが先に読まれるように） */
export function pageTitle(page: string | null): string {
  return page === null || page === "" ? APP_NAME : `${page} - ${APP_NAME}`;
}
