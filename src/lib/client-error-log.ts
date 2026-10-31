// 画面の例外をログに書く。Web 版の clientLog は何もしない。
import { clientLog, errorMessage } from "@/lib/tauri";

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : errorMessage(error);
}

export function logClientError(context: string, error: unknown): void {
  clientLog(`${context}: ${describeError(error)}`).catch(() => {
    // 書けなくても画面の動作は続ける。ここで例外にすると、拾った例外の報告がまた例外になる
  });
}

/** どの画面にも拾われなかった例外をログに書く。 */
export function startClientErrorLog(): void {
  window.addEventListener("error", (event) => {
    const error: unknown = event.error;
    logClientError("例外", error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    logClientError("処理されなかった失敗", event.reason);
  });
}
