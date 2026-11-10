import { CheckIcon, LinkIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText } from "@/lib/clipboard";
import { errorMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";

// 押した結果を、押した場所を見たまま確かめられる長さだけ出す
const COPIED_MS = 2000;

interface CopyLinkButtonProps {
  url: string;
  /** 何へのリンクか（読み上げとツールチップに使う。例: 「このマニュアル」「「止血帯を使う」」） */
  label: string;
  /**
   * `hover` は、囲んだ `group/link-target` にマウスを載せたときと、このボタンにキーでフォーカスしたときだけ出す
   * （見出しと目次の項目ごとに常に出すと、本文と目次がボタンで埋まるため）。
   * マウスのない端末では載せる操作がないので、常に出す。
   */
  reveal?: "always" | "hover";
  /** 上の帯では、並ぶほかのボタン（お気に入りなど）と大きさをそろえる */
  size?: "icon-xs" | "icon-sm";
  className?: string;
}

/** リンクをクリップボードに写すボタン。結果はツールチップに出し、読み上げにも伝える。 */
export function CopyLinkButton({
  url,
  label,
  reveal = "always",
  size = "icon-xs",
  className,
}: CopyLinkButtonProps): JSX.Element {
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
  const text = `${label}へのリンクをコピー`;
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
              aria-label={text}
              data-copied={copied ? "" : undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                reveal === "hover" &&
                  "opacity-0 group-hover/link-target:opacity-100 focus-visible:opacity-100 data-copied:opacity-100 [@media(hover:none)]:opacity-100",
                className,
              )}
              onClick={() => {
                copyText(url).then(
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
          {copied ? <CheckIcon /> : <LinkIcon />}
        </TooltipTrigger>
        <TooltipContent>
          {error !== null
            ? `コピーできませんでした: ${error}`
            : copied
              ? "リンクをコピーしました"
              : text}
        </TooltipContent>
      </Tooltip>
      {/* ツールチップは読み上げに届かないことがあるので、結果は別に伝える */}
      <span role="status" className="sr-only">
        {copied ? "リンクをコピーしました" : ""}
      </span>
      <span role="alert" className="sr-only">
        {error === null ? "" : `リンクをコピーできませんでした: ${error}`}
      </span>
    </>
  );
}
