import { LinkIcon } from "lucide-react";
import type { JSX } from "react";

import { CopyButton } from "@/features/library/viewer/CopyButton";
import { cn } from "@/lib/utils";

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
  return (
    <CopyButton
      value={() => url}
      label={`${label}へのリンクをコピー`}
      doneLabel="リンクをコピーしました"
      failLabel="リンクをコピーできませんでした"
      icon={<LinkIcon />}
      size={size}
      className={cn(
        reveal === "hover" &&
          "opacity-0 group-hover/link-target:opacity-100 focus-visible:opacity-100 data-copied:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    />
  );
}
