// Rust のコマンドが返すエラー（AppError）の判定と文言。デスクトップ版と Web 版の実装の両方から使う
import type { AppError } from "@/lib/bindings/AppError";
import type { ErrorKind } from "@/lib/bindings/ErrorKind";

// Record にしておくと、Rust 側で ErrorKind が増えたときに生成された型との不一致がコンパイルエラーになる
const ERROR_KINDS: Record<ErrorKind, true> = {
  io: true,
  not_found: true,
  invalid_input: true,
  forbidden: true,
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
