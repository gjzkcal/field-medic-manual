import { CheckIcon } from "lucide-react";
import { useEffect, useState, type JSX, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText } from "@/lib/clipboard";
import { errorMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";

// 押した結果を、押した場所を見たまま確かめられる長さだけ出す
const COPIED_MS = 2000;

export interface CopyButtonProps {
  /** 写す文字列。押したときに作る（回答の全文のように、作るのに手間がかかるものもあるため） */
  value: () => string;
  /** ボタンの名前（読み上げとツールチップ）。例: 「回答をコピー」 */
  label: string;
  /** 写せたときの知らせ。例: 「回答をコピーしました」 */
  doneLabel: string;
  /** 写せなかったときの知らせの頭。例: 「回答をコピーできませんでした」 */
  failLabel: string;
  icon: ReactNode;
  size?: "icon-xs" | "icon-sm";
  /** ボタンに足すクラス（`data-copied` の間も出すなど、出し方の指定） */
  className?: string;
}

/** 文字列をクリップボードに写すボタン。結果はツールチップに出し、読み上げにも伝える。 */
export function CopyButton({
  value,
  label,
  doneLabel,
  failLabel,
  icon,
  size = "icon-xs",
  className,
}: CopyButtonProps): JSX.Element {
  const [hoverOpen, setHoverOpen] = useState(false);
  // 押すたびに時刻を変え、続けて押したときも表示の時間を数え直す
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (copiedAt === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCopiedAt(null);
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copiedAt]);

  const copied = copiedAt !== null;
  return (
    <>
      <Tooltip
        // 押した結果は、マウスを離していても少しの間出しておく（「ボタンの横に短く出す」）
        open={hoverOpen || copied || error !== null}
        onOpenChange={(open) => {
          setHoverOpen(open);
          if (!open) {
            setError(null);
          }
        }}
      >
        <TooltipTrigger
          closeOnClick={false}
          render={
            <Button
              variant="ghost"
              size={size}
              aria-label={label}
              data-copied={copied ? "" : undefined}
              className={cn("text-muted-foreground hover:text-foreground", className)}
              onClick={() => {
                copyText(value()).then(
                  () => {
                    setError(null);
                    setCopiedAt(Date.now());
                  },
                  (e: unknown) => {
                    setCopiedAt(null);
                    setError(errorMessage(e));
                  },
                );
              }}
            />
          }
        >
          {copied ? <CheckIcon /> : icon}
        </TooltipTrigger>
        <TooltipContent>
          {error !== null ? `コピーできませんでした: ${error}` : copied ? doneLabel : label}
        </TooltipContent>
      </Tooltip>
      {/* ツールチップは読み上げに届かないことがあるので、結果は別に伝える */}
      <span role="status" className="sr-only">
        {copied ? doneLabel : ""}
      </span>
      <span role="alert" className="sr-only">
        {error === null ? "" : `${failLabel}: ${error}`}
      </span>
    </>
  );
}
