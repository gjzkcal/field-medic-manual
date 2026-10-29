import type { JSX, ReactNode } from "react";

import type { HeadingNode } from "@/features/library/viewer/heading-tree";

interface HeadingListProps<T> {
  nodes: readonly HeadingNode<T>[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  className: string;
  /** 2 段目以降の ul。字下げは項目の側でレベルから付けるので、ここでは間隔だけを決める */
  nestedClassName: string;
}

/**
 * 目次と見出しツリーの入れ子のリスト。見出しの階層を字下げの見た目だけでなく、リストの構造でも伝える
 * （読み上げで「2 段目のリスト」と分かり、節の中の小見出しを飛ばして進める。WCAG 1.3.1）
 */
export function HeadingList<T>({
  nodes,
  itemKey,
  renderItem,
  className,
  nestedClassName,
}: HeadingListProps<T>): JSX.Element {
  return (
    <ul className={className}>
      {nodes.map((node) => (
        <li key={itemKey(node.item)}>
          {renderItem(node.item)}
          {node.children.length > 0 && (
            <HeadingList
              nodes={node.children}
              itemKey={itemKey}
              renderItem={renderItem}
              className={nestedClassName}
              nestedClassName={nestedClassName}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
