import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  onWindowResized,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowToggleMaximize,
} from "@/lib/tauri";

// Windows のキャプションボタンに合わせ、バーの高さいっぱい・角丸なしにする
const CAPTION_BUTTON_CLASS = "h-full w-12 rounded-none";

export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // アンマウント後（StrictMode の二重実行を含む）に state を触ったり、購読を残したりしないため
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const syncMaximized = (): void => {
      windowIsMaximized()
        .then((value) => {
          if (!cancelled) {
            setMaximized(value);
          }
        })
        .catch(() => {
          // 取得できなくてもボタンの操作自体は動くので、アイコンを「最大化」のままにしておく
        });
    };

    syncMaximized();
    // 最大化はダブルクリックや Win+↑ でも切り替わるので、ボタンのクリックではなくリサイズで追従する
    onWindowResized(syncMaximized)
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // 購読できない場合も、起動時の状態表示だけで操作は続けられる
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="flex h-full shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className={CAPTION_BUTTON_CLASS}
        aria-label="最小化"
        onClick={() => {
          void windowMinimize();
        }}
      >
        <MinusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={CAPTION_BUTTON_CLASS}
        aria-label={maximized ? "元に戻す" : "最大化"}
        onClick={() => {
          void windowToggleMaximize();
        }}
      >
        {maximized ? <CopyIcon className="size-3.5" /> : <SquareIcon className="size-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        // Windows の慣習どおり、閉じるボタンだけホバー時に赤くして押し間違いに気づけるようにする
        className={`${CAPTION_BUTTON_CLASS} hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white`}
        aria-label="閉じる"
        onClick={() => {
          void windowClose();
        }}
      >
        <XIcon />
      </Button>
    </div>
  );
}
