// Web 版（vite --mode web）で src/lib/tauri.ts の代わりに読む実装。関数の名前と型は tauri.ts とそろえる
// （各関数に `typeof Desktop.xxx` の型を付け、足し忘れはテストの型の突き合わせで見つける）。
// 画面は同じものを使い、Rust の代わりに、同梱した原稿をブラウザで変換したメモリの表から返す。
// Web 版にない機能（トリアージ・お気に入り・履歴・ホットキー・小窓・更新）は、空の結果か何もしない関数にする。
import { version } from "../../package.json";
import type * as Desktop from "./tauri";

import { isExternalUrl } from "@/lib/external-url";
import { fromPrebuilt } from "@/web/backend/prebuilt";
import { searchStore } from "@/web/backend/search";
import { findDoc, listDocs, outlineDocs, tagCounts, type WebStore } from "@/web/backend/store";
import { readLocalSetting, writeLocalSetting } from "@/web/local-settings";
import { WebAppError } from "@/web/web-error";

export { errorMessage, isAppError } from "@/lib/app-error";
export type {
  AssetPutMeta,
  DownloadProgress,
  PendingUpdate,
  SearchOptions,
  UpdateInfo,
} from "./tauri";

let storePromise: Promise<WebStore> | undefined;

/**
 * 原稿の表は、最初に使われたときに 1 回だけ読む。本番はビルドのときに変換した結果を読むだけにし
 * （ブラウザで全原稿を変換すると、スマホで数秒かかるため）、変換のコード（unified など）をバンドルに入れない。
 * 開発サーバーとテストは、原稿の直しがすぐ反映されるよう、その場で変換する。
 */
async function getStore(): Promise<WebStore> {
  storePromise ??= import.meta.env.DEV
    ? import("@/web/backend/load").then((m) => m.loadWebStore())
    : import("virtual:web-store").then((m) => fromPrebuilt(m.default));
  try {
    return await storePromise;
  } catch (error: unknown) {
    // 失敗を覚えたままにせず、次の操作（再読み込みのボタンなど）でやり直せるようにする
    storePromise = undefined;
    throw new WebAppError(
      "internal",
      `マニュアルを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function unsupported(feature: string): Promise<never> {
  return Promise.reject(new WebAppError("invalid_input", `Web 版では${feature}を使えません`));
}

const noop = (): Promise<void> => Promise.resolve();
const noopUnlisten = (): Promise<() => void> =>
  Promise.resolve(() => {
    // 購読していないので、解除することもない
  });

export const appVersion: typeof Desktop.appVersion = () => Promise.resolve(version);

export const docUpsert: typeof Desktop.docUpsert = () => unsupported("原稿の保存");

export const docList: typeof Desktop.docList = async () => listDocs(await getStore());

export const docGet: typeof Desktop.docGet = async (id) => {
  const doc = findDoc(await getStore(), id);
  if (doc === undefined) {
    throw new WebAppError("not_found", `マニュアルが見つかりません: ${id}`);
  }
  return doc;
};

export const docOutline: typeof Desktop.docOutline = async () => outlineDocs(await getStore());

export const docDelete: typeof Desktop.docDelete = () => unsupported("原稿の削除");

export const assetPut: typeof Desktop.assetPut = () => unsupported("画像の保存");

export const assetGet: typeof Desktop.assetGet = async (id) => {
  const asset = (await getStore()).assets.get(id);
  if (asset === undefined) {
    throw new WebAppError("not_found", `画像が見つかりません: ${id}`);
  }
  // 呼び出し側が Blob にする。共有の ArrayBuffer を渡さないよう写しを返す
  return asset.bytes.slice().buffer;
};

export const searchQuery: typeof Desktop.searchQuery = async (q, options) =>
  searchStore(await getStore(), q, options);

export const tagList: typeof Desktop.tagList = async () => tagCounts(await getStore());

export const synonymList: typeof Desktop.synonymList = () => Promise.resolve([]);
export const synonymSave: typeof Desktop.synonymSave = () => unsupported("同義語の編集");
export const synonymDelete: typeof Desktop.synonymDelete = () => unsupported("同義語の編集");

export const triageList: typeof Desktop.triageList = () => Promise.resolve([]);
export const triageGet: typeof Desktop.triageGet = (id) =>
  Promise.reject(new WebAppError("not_found", `Web 版にはトリアージのフローがありません: ${id}`));
export const triageUpsert: typeof Desktop.triageUpsert = () => unsupported("フローの保存");
export const triageDelete: typeof Desktop.triageDelete = () => unsupported("フローの削除");

export const quickrefList: typeof Desktop.quickrefList = async () => (await getStore()).quickref;
export const quickrefReplaceAll: typeof Desktop.quickrefReplaceAll = () =>
  unsupported("クイック表の保存");

export const settingsGet: typeof Desktop.settingsGet = (key) =>
  Promise.resolve(readLocalSetting(key));

export const settingsSet: typeof Desktop.settingsSet = (key, value) =>
  // 書けなかったときの例外を reject にする
  new Promise((resolve) => {
    writeLocalSetting(key, value);
    resolve();
  });

export const favToggle: typeof Desktop.favToggle = () => unsupported("お気に入り");
export const favList: typeof Desktop.favList = () => Promise.resolve([]);
export const historyPush: typeof Desktop.historyPush = noop;
export const historyList: typeof Desktop.historyList = () => Promise.resolve([]);

export const hotkeyList: typeof Desktop.hotkeyList = () => Promise.resolve([]);
export const hotkeySet: typeof Desktop.hotkeySet = () => unsupported("ホットキー");

export const windowOpenInMain: typeof Desktop.windowOpenInMain = noop;
export const overlayActivate: typeof Desktop.overlayActivate = noop;
export const mainWindowReady: typeof Desktop.mainWindowReady = noop;
export const onOverlayMode: typeof Desktop.onOverlayMode = noopUnlisten;
export const onOpenHref: typeof Desktop.onOpenHref = noopUnlisten;
export const currentWindowLabel: typeof Desktop.currentWindowLabel = () => "main";

export const openExternal: typeof Desktop.openExternal = (url) => {
  if (!isExternalUrl(url)) {
    return Promise.reject(new WebAppError("invalid_input", `外部で開けない URL です: ${url}`));
  }
  // 開いたページからこのサイトを操作されないよう、opener を渡さない
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
};

// 更新はブラウザの再読み込みで届くので、確かめることはない
export const checkForUpdate: typeof Desktop.checkForUpdate = () => Promise.resolve(null);
export const relaunchApp: typeof Desktop.relaunchApp = noop;

export const windowMinimize: typeof Desktop.windowMinimize = noop;
export const windowToggleMaximize: typeof Desktop.windowToggleMaximize = noop;
export const windowClose: typeof Desktop.windowClose = noop;
export const windowHide: typeof Desktop.windowHide = noop;
export const windowIsMaximized: typeof Desktop.windowIsMaximized = () => Promise.resolve(false);
export const onWindowResized: typeof Desktop.onWindowResized = noopUnlisten;
