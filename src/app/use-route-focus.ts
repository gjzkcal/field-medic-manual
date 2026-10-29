import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "react-router";

/**
 * 移った先の画面の始まり（最初の h1、なければ本文の領域）にフォーカスを置く。
 * 押したリンクは画面ごと消えるので、何もしないとフォーカスが body に落ち、
 * キーボードでは先頭から、読み上げでは何が起きたか分からないまま探し直すことになる（WCAG 2.4.3）
 */
export function focusPageStart(root: HTMLElement): void {
  focusTarget(root.querySelector<HTMLElement>("h1") ?? root);
}

/** 見出しなどの押せない要素へフォーカスを移す。スクロールは呼び出し側が決める（ビューアは余白を空けて合わせる） */
export function focusTarget(target: HTMLElement): void {
  if (!target.hasAttribute("tabindex")) {
    // Tab の順には入れず、スクリプトからだけフォーカスできるようにする
    target.tabIndex = -1;
  }
  target.focus({ preventScroll: true });
}

/** 画面（pathname）が変わったら focusPageStart する。クエリやアンカーだけの変化では動かさない */
export function useRouteFocus(main: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  // 前の画面と比べる。最初の描画（と StrictMode の二度目の実行）では動かさない
  const previousRef = useRef(pathname);
  useEffect(() => {
    if (previousRef.current === pathname) {
      return;
    }
    previousRef.current = pathname;
    const root = main.current;
    if (root === null) {
      return;
    }
    // 子の画面が自分で置いた（トリアージの質問の見出しなど）ときは、それを優先する。子の effect が先に走る
    const active = document.activeElement;
    if (active !== null && active !== root && root.contains(active)) {
      return;
    }
    focusPageStart(root);
  }, [pathname, main]);
}
