// vite.config.ts（<head> に入れるスクリプト）からも読むので、ほかのファイルを import しない

/** gjzkcal.github.io の配下はほかのリポジトリのサイトとも origin を共有するので、キーに名前を付けて分ける */
export const LOCAL_SETTINGS_PREFIX = "field-medic-manual:settings:";

/** 負傷者の記録。設定と違って形の検査も消去も別に扱うので、頭の名前を分ける */
export const LOCAL_CASUALTIES_KEY = "field-medic-manual:casualties:log";
