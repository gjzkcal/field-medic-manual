// クイック表の画面の URL。行を指すときは `?row=<id>`（検索・お気に入り・フローのリンクから開く）。

export const QUICKREF_PATH = "/quickref";
export const ROW_PARAM = "row";

export function quickrefHref(rowId: string): string {
  return `${QUICKREF_PATH}?${new URLSearchParams({ [ROW_PARAM]: rowId }).toString()}`;
}

/** 行のカードの要素の id（スクロールとハイライトに使う） */
export function rowElementId(rowId: string): string {
  return `quickref-row-${rowId}`;
}
