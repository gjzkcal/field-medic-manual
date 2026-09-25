// Rust 側の呼び出し（自作コマンドと Tauri のウィンドウ API）はすべてこのファイルを経由する。
// コマンド名の文字列と戻り値の型を 1 か所にまとめ、呼び出し側で invoke の型引数を書き間違えないようにするため。
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { AppError } from "@/lib/bindings/AppError";
import type { ErrorKind } from "@/lib/bindings/ErrorKind";

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

export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
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
