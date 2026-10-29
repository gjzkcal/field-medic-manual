// 描いた画面を axe-core で調べ、WCAG 2.2 の A・AA に当たる違反を「規則: 要素」の一覧で返す（テストで [] と比べる）。
// jsdom は大きさと色を計算しないので、それに頼る規則は外す。色は contrast.test.ts と Lighthouse（Web 版の全ページ）で、
// 押せる大きさと横スクロールは手で確かめる
import axe from "axe-core";

const LAYOUT_RULES = ["color-contrast", "target-size", "scrollable-region-focusable"];

export async function axeViolations(root: Element = document.body): Promise<string[]> {
  const result = await axe.run(root, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"],
    },
    rules: Object.fromEntries(LAYOUT_RULES.map((id) => [id, { enabled: false }])),
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}
