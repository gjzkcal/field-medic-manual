import { StarIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toggleFavorite, useIsFavorite } from "@/features/prefs/prefs-store";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";
import { errorMessage } from "@/lib/tauri";

interface FavoriteButtonProps {
  target: PrefTarget;
  /** 何をお気に入りにするか（読み上げとツールチップに使う。例: 「このマニュアル」） */
  label: string;
}

/** お気に入りの切り替え。入っているときは星を塗りつぶす。 */
export function FavoriteButton({ target, label }: FavoriteButtonProps): JSX.Element {
  const on = useIsFavorite(target);
  const [error, setError] = useState<string | null>(null);
  const text = on ? `${label}をお気に入りから外す` : `${label}をお気に入りに入れる`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={on}
            aria-label={text}
            onClick={() => {
              toggleFavorite(target).then(
                () => {
                  setError(null);
                },
                (e: unknown) => {
                  setError(errorMessage(e));
                },
              );
            }}
          />
        }
      >
        <StarIcon className={on ? "fill-amber-400 text-amber-400" : undefined} />
      </TooltipTrigger>
      <TooltipContent>
        {error === null ? text : `切り替えられませんでした: ${error}`}
      </TooltipContent>
    </Tooltip>
  );
}
