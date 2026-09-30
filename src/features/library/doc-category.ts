// 原稿を分類（front matter の category）ごとにまとめる。ライブラリ画面と見出しツリーで同じ規則にするため共通にする。

export interface CategoryGroup<T> {
  /** null は分類のない原稿 */
  category: string | null;
  items: T[];
}

/**
 * 並んだ順（order 順）に最初に出た分類の順でまとめる。分類の一覧を別に持たず、原稿の order だけで分類の並びが決まるようにするため。
 * 分類のない原稿は末尾にまとめる。
 */
export function groupByCategory<T extends { meta: { category: string | null } }>(
  docs: readonly T[],
): CategoryGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const doc of docs) {
    const items = groups.get(doc.meta.category);
    if (items === undefined) {
      groups.set(doc.meta.category, [doc]);
    } else {
      items.push(doc);
    }
  }
  const result = [...groups].map(([category, items]) => ({ category, items }));
  return [
    ...result.filter((g) => g.category !== null),
    ...result.filter((g) => g.category === null),
  ];
}

export function categoryLabel(category: string | null): string {
  return category ?? "その他";
}
