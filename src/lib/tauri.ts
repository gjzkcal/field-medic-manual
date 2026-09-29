// Rust 側の呼び出し（自作コマンドと Tauri のウィンドウ API）はすべてこのファイルを経由する。
// コマンド名の文字列と戻り値の型を 1 か所にまとめ、呼び出し側で invoke の型引数を書き間違えないようにするため。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

import type { AppError } from "@/lib/bindings/AppError";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { DocUpsertInput } from "@/lib/bindings/DocUpsertInput";
import type { ErrorKind } from "@/lib/bindings/ErrorKind";
import type { HotkeyAction } from "@/lib/bindings/HotkeyAction";
import type { HotkeyBinding } from "@/lib/bindings/HotkeyBinding";
import type { OverlayMode } from "@/lib/bindings/OverlayMode";
import type { PrefItem } from "@/lib/bindings/PrefItem";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";
import type { QuickrefReplaceInput } from "@/lib/bindings/QuickrefReplaceInput";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import type { SearchFilter } from "@/lib/bindings/SearchFilter";
import type { SearchHit } from "@/lib/bindings/SearchHit";
import type { SynonymGroup } from "@/lib/bindings/SynonymGroup";
import type { SynonymGroupInput } from "@/lib/bindings/SynonymGroupInput";
import type { TagCount } from "@/lib/bindings/TagCount";
import type { TriageDetail } from "@/lib/bindings/TriageDetail";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";
import type { TriageUpsertInput } from "@/lib/bindings/TriageUpsertInput";

// Record にしておくと、Rust 側で ErrorKind が増えたときに生成された型との不一致がコンパイルエラーになる
const ERROR_KINDS: Record<ErrorKind, true> = {
  io: true,
  not_found: true,
  invalid_input: true,
  internal: true,
};

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("kind" in value) || !("message" in value)) {
    return false;
  }
  return (
    typeof value.kind === "string" &&
    Object.hasOwn(ERROR_KINDS, value.kind) &&
    typeof value.message === "string"
  );
}

/** 画面に出すためのエラーの文言。コマンドの失敗は AppError、それ以外（通信の失敗など）は文字列にする。 */
export function errorMessage(error: unknown): string {
  // Error は String() だと「Error: 」が付くので、message だけを出す
  if (isAppError(error) || error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** 保存したドキュメントの id を返す。同じ sourcePath のドキュメントがあれば、id を引き継いで置き換える。 */
export async function docUpsert(input: DocUpsertInput): Promise<string> {
  return invoke<string>("doc_upsert", { input });
}

export async function docList(): Promise<DocSummary[]> {
  return invoke<DocSummary[]>("doc_list");
}

export async function docGet(id: string): Promise<DocDetail> {
  return invoke<DocDetail>("doc_get", { id });
}

/** 全ドキュメントの h1〜h3 の見出し（本文なし）。 */
export async function docOutline(): Promise<DocOutline[]> {
  return invoke<DocOutline[]>("doc_outline");
}

export async function docDelete(id: string): Promise<void> {
  return invoke<undefined>("doc_delete", { id });
}

export interface AssetPutMeta {
  fileName: string;
  mime: string;
}

/** アセットを保存して id（Rust が計算した sha256）を返す。 */
export async function assetPut(bytes: Uint8Array, meta: AssetPutMeta): Promise<string> {
  // 中身は JSON にせず raw body で送る（数値の配列に変換すると大きなファイルで遅くなるため）。
  // 名前と MIME はヘッダで送る。ヘッダは ASCII しか通らないので、ファイル名は URL エンコードする
  return invoke<string>("asset_put", bytes, {
    headers: { "x-file-name": encodeURIComponent(meta.fileName), "x-mime": meta.mime },
  });
}

export async function assetGet(id: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("asset_get", { id });
}

export interface SearchOptions {
  /** 省略時 20、最大 100 */
  limit?: number;
  filter?: SearchFilter;
}

export async function searchQuery(q: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_query", {
    q,
    limit: options.limit ?? null,
    filter: options.filter ?? null,
  });
}

export async function tagList(): Promise<TagCount[]> {
  return invoke<TagCount[]>("tag_list");
}

export async function synonymList(): Promise<SynonymGroup[]> {
  return invoke<SynonymGroup[]>("synonym_list");
}

/** group.id が null なら新規作成、あれば語を丸ごと置き換える。 */
export async function synonymSave(group: SynonymGroupInput): Promise<SynonymGroup> {
  return invoke<SynonymGroup>("synonym_save", { group });
}

export async function synonymDelete(id: number): Promise<void> {
  return invoke<undefined>("synonym_delete", { id });
}

export async function triageList(): Promise<TriageSummary[]> {
  return invoke<TriageSummary[]>("triage_list");
}

/** json はフロー全体の JSON の文字列。形は呼び出し側で zod で確かめる。 */
export async function triageGet(id: string): Promise<TriageDetail> {
  return invoke<TriageDetail>("triage_get", { id });
}

/** 同じ id のフローがあれば置き換える。 */
export async function triageUpsert(input: TriageUpsertInput): Promise<void> {
  return invoke<undefined>("triage_upsert", { input });
}

export async function triageDelete(id: string): Promise<void> {
  return invoke<undefined>("triage_delete", { id });
}

export async function quickrefList(): Promise<QuickrefTable> {
  return invoke<QuickrefTable>("quickref_list");
}

/** 全行を置き換える。起動時の同期で、同梱ファイルが変わったときに使う。 */
export async function quickrefReplaceAll(input: QuickrefReplaceInput): Promise<void> {
  return invoke<undefined>("quickref_replace_all", { input });
}

/**
 * 設定の値を返す。保存されていなければ null。
 * 中身は任意の JSON なので unknown で返し、呼び出し側で形を検査する（古い版で保存した値などに備えるため）。
 */
export async function settingsGet(key: string): Promise<unknown> {
  return invoke<unknown>("settings_get", { key });
}

export async function settingsSet(key: string, value: unknown): Promise<void> {
  return invoke<undefined>("settings_set", { key, value });
}

/** お気に入りに入れたら true、外したら false。 */
export async function favToggle(target: PrefTarget): Promise<boolean> {
  return invoke<boolean>("fav_toggle", { target });
}

/** お気に入りを新しい順に。対象（文書・節・フロー）が消えたものは含まない。 */
export async function favList(): Promise<PrefItem[]> {
  return invoke<PrefItem[]>("fav_list");
}

export async function historyPush(target: PrefTarget): Promise<void> {
  return invoke<undefined>("history_push", { target });
}

/** 最近開いたものを新しい順に、対象ごとに 1 件ずつ。 */
export async function historyList(limit: number): Promise<PrefItem[]> {
  return invoke<PrefItem[]>("history_list", { limit });
}

export async function hotkeyList(): Promise<HotkeyBinding[]> {
  return invoke<HotkeyBinding[]>("hotkey_list");
}

/** 登録できなければ（ほかのアプリが使っているなど）元のキーのまま AppError で失敗する。 */
export async function hotkeySet(action: HotkeyAction, accelerator: string): Promise<void> {
  return invoke<undefined>("hotkey_set", { action, accelerator });
}

/** 小窓で開いている画面（アプリ内のパス）を、メインウィンドウで開く。 */
export async function windowOpenInMain(href: string): Promise<void> {
  return invoke<undefined>("window_open_in_main", { href });
}

/** 閲覧モードの小窓（フォーカスしない表示）で、文字を打つためにフォーカスを移す。 */
export async function overlayActivate(): Promise<void> {
  return invoke<undefined>("overlay_activate");
}

/** メインの最初の画面を描き終えたことを知らせ、非表示で起動したメインを出してもらう。2 回目以降は何もしない。 */
export async function mainWindowReady(): Promise<void> {
  return invoke<undefined>("main_window_ready");
}

/** Rust と取り決めたイベント名（src-tauri/src/window/overlay.rs）。 */
const OVERLAY_MODE_EVENT = "overlay-mode";
const OPEN_HREF_EVENT = "open-href";

/** 小窓が呼び出されたとき（ホットキーやトレイ）。戻り値の関数を呼ぶと購読を解除する。 */
export async function onOverlayMode(handler: (mode: OverlayMode) => void): Promise<() => void> {
  return listen<OverlayMode>(OVERLAY_MODE_EVENT, (event) => {
    handler(event.payload);
  });
}

/** 小窓の「メインで開く」やトレイの「設定」で、メインウィンドウに開かせる画面。 */
export async function onOpenHref(handler: (href: string) => void): Promise<() => void> {
  return listen<string>(OPEN_HREF_EVENT, (event) => {
    handler(event.payload);
  });
}

/** 今のウィンドウのラベル（`main` / `overlay`）。同じ index.html を読むので、描く画面をこれで分ける。 */
export function currentWindowLabel(): string {
  return getCurrentWindow().label;
}

/** 既定のブラウザ（mailto はメールソフト）で開く。WebView の中では開かない。 */
export async function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

/** 更新の確認に掛ける時間の上限。オフラインのときに確認が終わらないまま残らないようにする */
const UPDATE_CHECK_TIMEOUT_MS = 15_000;

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** 公開日（RFC 3339）。latest.json に無ければ null */
  date: string | null;
  /** CHANGELOG のその版の節（Markdown のテキスト） */
  notes: string;
}

export interface DownloadProgress {
  downloaded: number;
  /** サーバーが大きさを返さなければ null */
  total: number | null;
}

/** 見つかった更新。プラグインの Update（Rust 側のリソース）を画面に直接触らせないため、操作を 2 つにまとめる */
export interface PendingUpdate {
  info: UpdateInfo;
  /** ダウンロードしてインストールする。Windows ではインストーラの起動と同時にアプリが終了し、更新後に起動し直す */
  install: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  /** 更新しないときに、Rust 側が持つリソースを放す */
  dismiss: () => Promise<void>;
}

/** GitHub Releases の latest.json を見て、今より新しい版があれば返す（署名は Rust 側で確かめる） */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
  if (update === null) {
    return null;
  }
  return {
    info: {
      version: update.version,
      currentVersion: update.currentVersion,
      date: update.date ?? null,
      notes: update.body ?? "",
    },
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            break;
          case "Finished":
            break;
        }
        onProgress({ downloaded, total });
      });
    },
    dismiss: async () => update.close(),
  };
}

/** 更新の後にアプリを起動し直す（Windows ではインストーラが起動し直すので、ここまで来ないことが多い） */
export async function relaunchApp(): Promise<void> {
  return relaunch();
}

export async function windowMinimize(): Promise<void> {
  return getCurrentWindow().minimize();
}

export async function windowToggleMaximize(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export async function windowClose(): Promise<void> {
  return getCurrentWindow().close();
}

export async function windowHide(): Promise<void> {
  return getCurrentWindow().hide();
}

export async function windowIsMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

/** 戻り値の関数を呼ぶと購読を解除する。 */
export async function onWindowResized(handler: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(handler);
}
