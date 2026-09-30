// ライブラリ画面の絞り込みと並び替え。原稿は多くても数十件なので、DB ではなく画面の中で行う。
import { isStale } from "@/features/library/stale";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";

export interface LibraryFilter {
  /** いずれかに当てはまるもの。空なら絞らない */
  modTargets: readonly ModTarget[];
  /** 指定した版のものと、版を問わないもの。null なら絞らない */
  channel: ModChannel | null;
  /** すべてを持つもの */
  tags: readonly string[];
  staleOnly: boolean;
}

export const EMPTY_FILTER: LibraryFilter = {
  modTargets: [],
  channel: null,
  tags: [],
  staleOnly: false,
};

/** order は原稿の front matter の order の順（作者が決めた読む順） */
export type LibrarySort = "order" | "title" | "updated";

export function isFiltering(filter: LibraryFilter): boolean {
  return (
    filter.modTargets.length > 0 ||
    filter.channel !== null ||
    filter.tags.length > 0 ||
    filter.staleOnly
  );
}

export function filterDocs(
  docs: readonly DocSummary[],
  filter: LibraryFilter,
  now: Date,
): DocSummary[] {
  return docs.filter((doc) => {
    const { modTarget, modChannel, tags, verifiedAt } = doc.meta;
    if (
      filter.modTargets.length > 0 &&
      (modTarget === null || !filter.modTargets.includes(modTarget))
    ) {
      return false;
    }
    if (filter.channel !== null && modChannel !== null && modChannel !== filter.channel) {
      return false;
    }
    if (!filter.tags.every((tag) => tags.includes(tag))) {
      return false;
    }
    return !filter.staleOnly || isStale(verifiedAt, now);
  });
}

const collator = new Intl.Collator("ja");

export function sortDocs(docs: readonly DocSummary[], sort: LibrarySort): DocSummary[] {
  const sorted = [...docs];
  switch (sort) {
    case "order":
      return sorted.sort((a, b) => {
        const byOrder = compareOrder(a.meta.order, b.meta.order);
        return byOrder === 0 ? collator.compare(a.title, b.title) : byOrder;
      });
    case "updated":
      // ISO 8601 の UTC なので文字列の比較で新しい順にできる
      return sorted.sort((a, b) => {
        const byDate = b.updatedAt.localeCompare(a.updatedAt);
        return byDate === 0 ? collator.compare(a.title, b.title) : byDate;
      });
    case "title":
      return sorted.sort((a, b) => collator.compare(a.title, b.title));
  }
}

/** 番号のないものは後ろにする（見出しツリーを並べる doc_list と同じ規則）。 */
function compareOrder(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return a - b;
}
