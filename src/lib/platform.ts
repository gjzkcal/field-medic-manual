/**
 * ブラウザ向けの Web 版（`vite --mode web`）のビルドなら true。
 * Web 版にない機能（トリアージ・お気に入り・ホットキーなど）の画面を、共有の部品の中で隠すのに使う。
 * ビルドでは定数に置き換わるので、デスクトップ版では分岐ごと消える。
 */
export const IS_WEB: boolean = import.meta.env.MODE === "web";
