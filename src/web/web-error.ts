import type { AppError } from "@/lib/bindings/AppError";
import type { ErrorKind } from "@/lib/bindings/ErrorKind";

/**
 * Web 版の失敗。デスクトップ版の Rust のエラー（AppError）と同じ kind と message を持つので、
 * 画面の isAppError と「見つかりません」などの出し分けがそのまま効く。Error を継承するのは、reject と throw に使うため。
 */
export class WebAppError extends Error implements AppError {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "WebAppError";
  }
}
