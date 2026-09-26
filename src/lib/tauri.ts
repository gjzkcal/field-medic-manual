// Rust 側の呼び出し（自作コマンドと Tauri のウィンドウ API）はすべてこのファイルを経由する。
// コマンド名の文字列と戻り値の型を 1 か所にまとめ、呼び出し側で invoke の型引数を書き間違えないようにするため。
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { AppError } from "@/lib/bindings/AppError";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { DocUpsertInput } from "@/lib/bindings/DocUpsertInput";
import type { ErrorKind } from "@/lib/bindings/ErrorKind";
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
  return isAppError(error) ? error.message : String(error);
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

/** 既定のブラウザ（mailto はメールソフト）で開く。WebView の中では開かない。 */
export async function openExternal(url: string): Promise<void> {
  return openUrl(url);
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

export async function windowIsMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

/** 戻り値の関数を呼ぶと購読を解除する。 */
export async function onWindowResized(handler: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(handler);
}
