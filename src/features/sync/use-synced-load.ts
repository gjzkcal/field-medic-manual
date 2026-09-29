// DB から画面に出すデータを読む。起動時の同期が終わったら読み直し、同梱物の更新を開いている画面にも反映する。
import { useEffect, useEffectEvent, useState } from "react";

import type { SyncStore } from "@/features/sync/store";

export type SyncedLoad<T> =
  { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: unknown };

/**
 * key: 何を読んでいるか（文書の id など）。変わったら読み終わるまで loading にする（前の文書を出さないため）。
 * 同期の状態が変わって読み直す間は、前の値を出したままにする。null なら読まない。
 * load は key と同期の状態が変わったときにだけ呼ぶので、key で区別できないものに頼らないこと。
 */
export function useSyncedLoad<T>(
  store: SyncStore,
  key: string | null,
  load: () => Promise<T>,
): SyncedLoad<T> {
  const syncStatus = store((s) => s.state.status);
  const [result, setResult] = useState<{ key: string; load: SyncedLoad<T> } | null>(null);
  const start = useEffectEvent(load);
  useEffect(() => {
    if (key === null) {
      return;
    }
    let cancelled = false;
    start().then(
      (value) => {
        if (!cancelled) {
          setResult({ key, load: { status: "ready", value } });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setResult({ key, load: { status: "error", error } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, syncStatus]);
  return result !== null && result.key === key ? result.load : { status: "loading" };
}
