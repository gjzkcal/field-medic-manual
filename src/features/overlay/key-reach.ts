import { useEffect, useState } from "react";

import { onOverlayKeys } from "@/lib/tauri";

/**
 * キー入力が小窓に届いているか。
 * 小窓は隠れた状態で始まるので、最初は false。知らせを受け取れないときも false のままにする
 * （届かないキーを案内するより、届くキーを案内しないほうが害がない）
 */
export function useOverlayKeysReach(): boolean {
  const [reach, setReach] = useState(false);

  useEffect(() => {
    // アンマウント後（StrictMode の二重実行を含む）に購読を残さないため
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onOverlayKeys(setReach)
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // 上のとおり false のままにする
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return reach;
}
