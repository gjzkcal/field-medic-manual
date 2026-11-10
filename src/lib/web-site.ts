// Web 版の公開先。vite.config.ts（ビルドの base）と、画面でコピーする共有のリンクの両方が読む。
// vite.config.ts から読めるよう、ほかのモジュールを import しない。

/** GitHub Pages のオリジン */
export const WEB_ORIGIN = "https://gjzkcal.github.io";

/** GitHub Pages の公開先（https://gjzkcal.github.io/field-medic-manual/）のパス */
export const WEB_BASE = "/field-medic-manual/";
