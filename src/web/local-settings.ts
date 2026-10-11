// Web 版の設定（デスクトップ版は SQLite の settings 表）をブラウザの localStorage に置く。
// 値は JSON にし、形は読む側（各設定の parse 関数）が確かめる。
import { WebAppError } from "@/web/web-error";

// gjzkcal.github.io の配下はほかのリポジトリのサイトとも origin を共有するので、キーに名前を付けて分ける
const KEY_PREFIX = "field-medic-manual:settings:";

/** 保存されていなければ null。読めないとき（プライベートブラウズで禁止されているなど）も null にして既定値で動かす。 */
export function readLocalSetting(key: string, storage: () => Storage = defaultStorage): unknown {
  try {
    const text = storage().getItem(KEY_PREFIX + key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** 書けなければ、デスクトップ版と同じ形のエラーで失敗する（設定の画面が「保存できませんでした」を出す）。 */
export function writeLocalSetting(
  key: string,
  value: unknown,
  storage: () => Storage = defaultStorage,
): void {
  try {
    storage().setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch (error: unknown) {
    throw new WebAppError(
      "io",
      `ブラウザに保存できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function defaultStorage(): Storage {
  // localStorage の参照そのものが例外を出すブラウザ設定があるので、関数にして try の中で触る
  return window.localStorage;
}
