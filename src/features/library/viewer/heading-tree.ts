export interface HeadingNode<T> {
  item: T;
  children: HeadingNode<T>[];
}

/** 見出しの並びを、レベルで入れ子にする（h2 の下に h3 を入れる）。飛んだレベル（h1 の次に h3）もすぐ上の見出しの下に入れる */
export function nestHeadings<T extends { level: number }>(items: readonly T[]): HeadingNode<T>[] {
  const roots: HeadingNode<T>[] = [];
  const stack: HeadingNode<T>[] = [];
  for (const item of items) {
    const node: HeadingNode<T> = { item, children: [] };
    while (stack.length > 0 && (stack.at(-1)?.item.level ?? 0) >= item.level) {
      stack.pop();
    }
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}
