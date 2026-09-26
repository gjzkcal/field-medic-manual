// 検索パレットの中に差し込んだ部品（お気に入り・最近見たもの）から、選んだ先を開くため。
// パレットは開く前に一覧を閉じるなどの後始末をするので、置き場所の遷移を直接呼ばずにこれを使う。
import { createContext, use } from "react";

export const PaletteOpenContext = createContext<((href: string) => void) | null>(null);

export function usePaletteOpen(): (href: string) => void {
  const open = use(PaletteOpenContext);
  if (open === null) {
    throw new Error("usePaletteOpen は CommandPalette の emptySlot の中で使ってください");
  }
  return open;
}
