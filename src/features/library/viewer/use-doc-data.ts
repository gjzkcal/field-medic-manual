// ビューアが表示するデータの読み込み。同期（起動時）が終わったら読み直し、原稿の更新を開いている画面にも反映する。
import { useEffect, useState } from "react";

import { useContentSync } from "@/features/content/sync";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import { docGet, docOutline, errorMessage, isAppError } from "@/lib/tauri";

export type DocLoad =
  | { status: "loading" }
  | { status: "ready"; doc: DocDetail }
  | { status: "not_found" }
  | { status: "error"; message: string };

export function useDoc(id: string): DocLoad {
  const syncStatus = useContentSync((s) => s.state.status);
  // どの id の結果かを一緒に持つ。id が変わった直後に前の文書を表示しないため
  const [result, setResult] = useState<{ id: string; load: DocLoad } | null>(null);
  useEffect(() => {
    let cancelled = false;
    docGet(id).then(
      (doc) => {
        if (!cancelled) {
          setResult({ id, load: { status: "ready", doc } });
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        const load: DocLoad =
          isAppError(error) && error.kind === "not_found"
            ? { status: "not_found" }
            : { status: "error", message: errorMessage(error) };
        setResult({ id, load });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, syncStatus]);
  return result?.id === id ? result.load : { status: "loading" };
}

/** 左のツリーと内部リンクの解決に使う。読めなければ空にする（本文の表示は止めない）。 */
export function useOutline(): DocOutline[] {
  const syncStatus = useContentSync((s) => s.state.status);
  const [outline, setOutline] = useState<DocOutline[]>([]);
  useEffect(() => {
    let cancelled = false;
    docOutline().then(
      (docs) => {
        if (!cancelled) {
          setOutline(docs);
        }
      },
      () => {
        if (!cancelled) {
          setOutline([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [syncStatus]);
  return outline;
}
