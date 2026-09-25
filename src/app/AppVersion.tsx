import { useEffect, useState, type JSX } from "react";

import { appVersion, isAppError } from "@/lib/tauri";

type VersionState =
  { status: "loading" } | { status: "ok"; version: string } | { status: "error"; message: string };

export function AppVersion(): JSX.Element {
  const [state, setState] = useState<VersionState>({ status: "loading" });

  useEffect(() => {
    // アンマウント後（StrictMode の二重実行を含む）に古い結果で state を上書きしないため
    let cancelled = false;
    appVersion()
      .then((version) => {
        if (!cancelled) {
          setState({ status: "ok", version });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: isAppError(error) ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  switch (state.status) {
    case "loading":
      return (
        <span className="px-2 text-xs text-muted-foreground select-none">バージョン確認中…</span>
      );
    case "ok":
      return (
        <span className="px-2 text-xs text-muted-foreground select-none">v{state.version}</span>
      );
    case "error":
      return (
        <span className="px-2 text-xs text-destructive select-none" title={state.message}>
          バージョンを取得できませんでした
        </span>
      );
  }
}
