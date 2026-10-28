// メインは非表示で起動し、最初の画面を描き終えてから出す。
// 描きかけの画面や、欧文があとからフォントを差し替えて動く様子を見せないため。
import { mainWindowReady } from "@/lib/tauri";

/** Geist は欧文だけを持つ（和文は OS のフォント）。本文の既定のサイズで読んでおく */
const FONT = '1em "Geist Variable"';
/** フォントを読めないときに起動を止めない上限 */
const FONT_WAIT_MS = 1000;

let waiting = false;
let ready: Promise<unknown> = Promise.resolve();

/**
 * main.tsx がメインのときだけ呼ぶ。小窓やテストでは revealMainWindow が何もしないように。
 * before は出す前に済ませておくもの（保存したテーマの読み込み。違うテーマの画面を一瞬でも見せないため）。失敗させないこと
 */
export function waitForFirstScreen(before: Promise<unknown> = Promise.resolve()): void {
  waiting = true;
  ready = before;
}

/** 最初の画面を描き終えたときに呼ぶ。待っていなければ（小窓・2 回目以降・テスト）何もしない。 */
export async function revealMainWindow(): Promise<void> {
  if (!waiting) {
    return;
  }
  waiting = false;
  await Promise.all([
    ready,
    Promise.race([
      document.fonts.load(FONT).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]),
  ]);
  try {
    await mainWindowReady();
  } catch {
    // 失敗しても Rust が起動から 5 秒で出すので、ここでは何もしない
  }
}
