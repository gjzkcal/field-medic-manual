import { lazy, Suspense, useLayoutEffect, useMemo, useRef, type JSX } from "react";
import { createPortal } from "react-dom";

import { readChartPayload, type ChartData, type ChartSpec } from "@/features/content/chart";
import { sanitizeToFragment } from "@/features/content/sanitize";

// Recharts は大きいので、グラフのある節を開くまで読み込まない（起動を遅くしないため）
const ManualChart = lazy(() =>
  import("@/features/library/viewer/ManualChart").then((m) => ({ default: m.ManualChart })),
);

interface SectionBodyProps {
  html: string;
  /** asset id から表示用の URL を得る */
  resolveAsset: (assetId: string) => Promise<string>;
}

interface ChartMount {
  host: HTMLElement;
  spec: ChartSpec;
  data: ChartData;
}

/**
 * 節の本文。表示の直前にもう一度無害化し、innerHTML を使わずに DOM として差し込む。
 * 画像は `data-asset-id` だけで保存しているので、ここで Blob URL を付ける。
 * `data-chart` の付いた表は、表の直前にグラフを描く（表は残す）。表なしのグラフは `data-chart` の付いた figure に描く。
 */
export function SectionBody({ html, resolveAsset }: SectionBodyProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // グラフの置き場所（表の直前の figure か、表なしのグラフの figure）は、描画の前に本文の DOM の中に作っておき、React からはポータルで描く。
  // 差し込む前に作るのは、差し込んだ後に state を更新するともう一度描画が要り、アンカーへのスクロールがずれるため
  const { nodes, charts } = useMemo(() => {
    const fragment = sanitizeToFragment(html);
    const mounts: ChartMount[] = [];
    for (const marked of Array.from(
      fragment.querySelectorAll<HTMLElement>("table[data-chart], figure[data-chart]"),
    )) {
      const isTable = marked instanceof HTMLTableElement;
      const payload = readChartPayload(marked.getAttribute("data-chart") ?? "");
      if (payload === null || payload.data.points.length < 2) {
        // 表なしのグラフの figure は中身が無く、描けなければ空の余白になるだけなので消す
        if (!isTable) {
          marked.remove();
        }
        continue;
      }
      let host = marked;
      if (isTable) {
        host = marked.ownerDocument.createElement("figure");
        marked.before(host);
      }
      host.className = "manual-chart";
      mounts.push({ host, ...payload });
    }
    // 開発時の StrictMode では effect が 2 回走るので、fragment ではなく節の子の一覧を持ち、何度でも差し込めるようにする
    return { nodes: Array.from(fragment.childNodes), charts: mounts };
  }, [html]);

  // 描画の前に差し込み、アンカーへのスクロールが本文の高さの揃った状態で行われるようにする
  useLayoutEffect(() => {
    const container = ref.current;
    if (container === null) {
      return;
    }
    container.replaceChildren(...nodes);
    let cancelled = false;
    for (const img of Array.from(container.querySelectorAll("img[data-asset-id]"))) {
      const assetId = img.getAttribute("data-asset-id") ?? "";
      resolveAsset(assetId).then(
        (url) => {
          if (!cancelled) {
            img.setAttribute("src", url);
          }
        },
        () => {
          if (!cancelled) {
            img.replaceWith(missingImage(img.getAttribute("alt") ?? ""));
          }
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [nodes, resolveAsset]);

  return (
    <>
      <div ref={ref} />
      {charts.map(({ host, spec, data }, i) =>
        createPortal(
          <Suspense fallback={null}>
            <ManualChart spec={spec} data={data} />
          </Suspense>,
          host,
          `chart-${String(i)}`,
        ),
      )}
    </>
  );
}

function missingImage(alt: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "manual-missing-image";
  span.textContent = alt === "" ? "［画像を表示できません］" : `［画像を表示できません: ${alt}］`;
  return span;
}
