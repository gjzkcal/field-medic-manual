import { useEffect, useState } from "react";

// 見出しが本文の上端からこの距離に入ったら「読んでいる節」とみなす（見出しの直下を読み始めた時点で切り替えるため）
const ACTIVE_OFFSET_PX = 96;

/**
 * スクロール位置から今読んでいる節の見出しを求める。
 * 画面に見出しが見えているかではなく「上端より上にある最後の見出し」で決めるので、見出しの見えない長い節の途中でも正しく追従する。
 */
export function useActiveAnchor(
  viewport: HTMLElement | null,
  anchors: readonly string[],
  headingOf: (anchor: string) => HTMLElement | undefined,
  /** 目次やリンクで移った先（URL のアンカー） */
  requested: string | null,
): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (viewport === null) {
      return;
    }
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const top = viewport.getBoundingClientRect().top + ACTIVE_OFFSET_PX;
      let current = anchors[0] ?? null;
      for (const anchor of anchors) {
        const heading = headingOf(anchor);
        if (heading === undefined) {
          continue;
        }
        if (heading.getBoundingClientRect().top > top) {
          break;
        }
        current = anchor;
      }
      // 終わりのほうの節は見出しが上端まで届かない。一番下まで来たら、移った先の見出しが見えていればそれを、
      // そうでなければ最後の見出しにする（押した見出しと違う項目が強調されないように）
      if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2) {
        const bounds = viewport.getBoundingClientRect();
        const requestedTop =
          requested === null ? undefined : headingOf(requested)?.getBoundingClientRect().top;
        current =
          requestedTop !== undefined && requestedTop >= bounds.top && requestedTop < bounds.bottom
            ? requested
            : (anchors.at(-1) ?? current);
      }
      setActive(current);
    };
    // スクロールのたびに計算せず、描画 1 回につき 1 回にまとめる
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };
    schedule();
    viewport.addEventListener("scroll", schedule, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [viewport, anchors, headingOf, requested]);

  return active;
}
