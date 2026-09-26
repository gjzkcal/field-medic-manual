import { FunnelIcon } from "lucide-react";
import { useEffect, useState, type JSX, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MOD_CHANNEL_LABELS, MOD_TARGET_LABELS, MOD_TARGET_VALUES } from "@/features/content/meta";
import { activeFilterCount, useSearchFilter } from "@/features/search/search-filter";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import { errorMessage, tagList } from "@/lib/tauri";

const MOD_CHANNELS: readonly ModChannel[] = ["release", "dev"];

/** 検索パレットの絞り込み（モジュール / 版 / タグ）。選んだ内容は保存され、次に開いたときも効く。 */
export function SearchFilterPopover(): JSX.Element {
  const filter = useSearchFilter((s) => s.filter);
  const update = useSearchFilter((s) => s.update);
  const storageError = useSearchFilter((s) => s.storageError);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);
  const count = activeFilterCount(filter);
  const errorText =
    tagError ?? (storageError === null ? null : `絞り込みを保存できませんでした: ${storageError}`);

  // タグは原稿の同期で変わるので、開くたびに読み直す
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let cancelled = false;
    tagList()
      .then((list) => {
        if (!cancelled) {
          setTags(list.map((t) => t.name).sort((a, b) => a.localeCompare(b, "ja")));
          setTagError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTagError(errorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 選んだあとで原稿から消えたタグも、外せるように並べておく
  const tagOptions = [...new Set([...tags, ...filter.tags])];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={count > 0 ? "secondary" : "ghost"}
            size="sm"
            aria-label={count > 0 ? `絞り込み（${String(count)} 件）` : "絞り込み"}
          />
        }
      >
        <FunnelIcon />
        絞り込み
        {count > 0 && <Badge className="h-4 min-w-4 px-1 tabular-nums">{count}</Badge>}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col gap-3"
        // 中身は body 直下に描かれるが、React のイベントはパレット（cmdk）まで伝わり、Enter で結果を開いてしまう。
        // Esc だけは Base UI がポップオーバーを閉じるのに使うので止めない
        onKeyDown={(event) => {
          if (event.key !== "Escape") {
            event.stopPropagation();
          }
        }}
      >
        <PopoverTitle>絞り込み</PopoverTitle>
        <FilterRow label="モジュール">
          <ToggleGroup
            multiple
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={filter.modTargets}
            onValueChange={(values) => {
              // ToggleGroup は string[] を返すので、既知の値だけを残して型を戻す
              update({ modTargets: MOD_TARGET_VALUES.filter((t) => values.includes(t)) });
            }}
          >
            {MOD_TARGET_VALUES.map((t) => (
              <ToggleGroupItem key={t} value={t}>
                {MOD_TARGET_LABELS[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FilterRow>
        <FilterRow label="版" note="版を問わない原稿は常に出る">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={filter.modChannel === null ? [] : [filter.modChannel]}
            onValueChange={(values) => {
              update({ modChannel: MOD_CHANNELS.find((c) => values.includes(c)) ?? null });
            }}
          >
            {MOD_CHANNELS.map((c) => (
              <ToggleGroupItem key={c} value={c}>
                {MOD_CHANNEL_LABELS[c]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FilterRow>
        <FilterRow label="タグ" note="選んだタグをすべて持つ節だけ">
          {tagOptions.length === 0 ? (
            <span className="text-xs text-muted-foreground">タグはまだありません</span>
          ) : (
            <ToggleGroup
              multiple
              variant="outline"
              size="sm"
              className="flex-wrap"
              value={filter.tags}
              onValueChange={(values) => {
                update({ tags: tagOptions.filter((t) => values.includes(t)) });
              }}
            >
              {tagOptions.map((t) => (
                <ToggleGroupItem key={t} value={t}>
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </FilterRow>
        {errorText !== null && <p className="text-xs text-destructive">{errorText}</p>}
        <Button
          variant="outline"
          size="sm"
          className="self-end"
          disabled={count === 0}
          onClick={() => {
            update({ modTargets: [], modChannel: null, tags: [] });
          }}
        >
          すべて解除
        </Button>
      </PopoverContent>
    </Popover>
  );
}

interface FilterRowProps {
  label: string;
  note?: string;
  children: ReactNode;
}

function FilterRow({ label, note, children }: FilterRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {note !== undefined && <span className="ml-2 font-normal">{note}</span>}
      </span>
      {children}
    </div>
  );
}
