// 回答の中に出す原稿の図。節の HTML から図の要素だけを取り出す（本文は回答が要約しているので、重ねて出さない）。

/** 図として出すもの（グラフにする表と表なしのグラフ・フローチャート・画像） */
const FIGURE_SELECTOR =
  "table[data-chart], figure[data-chart], figure[data-flowchart], img[data-asset-id]";

/** 節の本文から図の要素だけを取り出す。図の中の図（figure の中の img など）は外側だけを残す。 */
export function figuresOnly(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = Array.from(doc.body.querySelectorAll(FIGURE_SELECTOR)).filter(
    (el) => (el.parentElement?.closest(FIGURE_SELECTOR) ?? null) === null,
  );
  return found.map((el) => el.outerHTML).join("");
}
