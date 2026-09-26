import { useLayoutEffect, useRef, type JSX } from "react";

import { sanitizeToFragment } from "@/features/content/sanitize";

interface SectionBodyProps {
  html: string;
  /** asset id から表示用の URL を得る */
  resolveAsset: (assetId: string) => Promise<string>;
}

/**
 * 節の本文。表示の直前にもう一度無害化し、innerHTML を使わずに DOM として差し込む。
 * 画像は `data-asset-id` だけで保存しているので、ここで Blob URL を付ける。
 */
export function SectionBody({ html, resolveAsset }: SectionBodyProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // 描画の前に差し込み、アンカーへのスクロールが本文の高さの揃った状態で行われるようにする
  useLayoutEffect(() => {
    const container = ref.current;
    if (container === null) {
      return;
    }
    container.replaceChildren(sanitizeToFragment(html));
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
  }, [html, resolveAsset]);

  return <div ref={ref} />;
}

function missingImage(alt: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "manual-missing-image";
  span.textContent = alt === "" ? "［画像を表示できません］" : `［画像を表示できません: ${alt}］`;
  return span;
}
