import { EyeOffIcon } from "lucide-react";
import type { JSX } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { conditionLabel, type ModConditions } from "@/features/settings/mod-conditions";

interface ModSectionsBarProps {
  summary: string;
  hiddenCount: number;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
}

/** 今の MOD の設定で節を絞っていることと、すべての組み合わせを出すスイッチ（クイック表と同じ形）。 */
export function ModSectionsBar({
  summary,
  hiddenCount,
  showAll,
  onShowAllChange,
}: ModSectionsBarProps): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm leading-normal text-muted-foreground">
      <span>
        {showAll
          ? "すべての組み合わせの節を表示しています"
          : `${summary} に合う節を表示しています（設定で変更）${hiddenCount > 0 ? `。${String(hiddenCount)} 節を省略` : ""}`}
      </span>
      {/* Base UI の Switch は囲んだ label の文字を名前にする */}
      <label className="flex items-center gap-2 font-medium text-foreground">
        <Switch checked={showAll} onCheckedChange={onShowAllChange} />
        すべての組み合わせを表示
      </label>
    </div>
  );
}

interface SectionLabelProps {
  anchor: string;
  /** 元の見出しのレベル（1〜6） */
  level: number;
  conditions: ModConditions;
  register: (anchor: string, el: HTMLElement | null) => (() => void) | undefined;
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * 絞り込み中に「〜を入れている場合」の見出しの代わりに出すラベル。
 * アンカーの移り先としてはそのまま使うので、見出しと同じく位置を登録する。
 * 見た目は小さなラベルにするが、節の区切りであることは変わらないので、元と同じレベルの見出しのままにする
 * （見出しで節をたどる読み上げの操作から抜けないように。WCAG 1.3.1）
 */
export function SectionLabel({
  anchor,
  level,
  conditions,
  register,
}: SectionLabelProps): JSX.Element {
  const Tag = HEADING_TAGS[Math.min(Math.max(level, 1), HEADING_TAGS.length) - 1] ?? "h6";
  return (
    <Tag
      ref={(el: HTMLHeadingElement | null) => register(anchor, el)}
      data-anchor={anchor}
      tabIndex={-1}
      // 本文の見出しの大きさ・罫線（index.css の .manual-body h2 など）を打ち消して、ラベルの見た目にする
      className="mt-6 mb-2 border-0 p-0 text-base leading-normal font-normal outline-none"
    >
      <Badge variant="outline">{conditionLabel(conditions)}</Badge>
    </Tag>
  );
}

/** リンクなどで直接開いた、今の設定では出さない節の印。読んでいる内容が自分の組み合わせと違うと分かるようにする */
export function HiddenSectionNotice({ conditions }: { conditions: ModConditions }): JSX.Element {
  const label = conditionLabel(conditions);
  return (
    // 開いたときから出ている印。role=alert だと開くたびに読み上げを遮るので、補足（note）にする
    <Alert role="note" className="mb-4 text-sm leading-normal">
      <EyeOffIcon />
      <AlertDescription>
        今の MOD の設定では表示しない組み合わせです{label === null ? "" : `（${label}）`}。
      </AlertDescription>
    </Alert>
  );
}
