// カードの残り時間を描き直す、共有の時計。タイマーの部品だけが購読し、カードやグラフは描き直さない。
import { useSyncExternalStore } from "react";

const TICK_MS = 1000;

let nowMs = Date.now();
let timerId: number | undefined;
let paused = false;
const listeners = new Set<() => void>();

function tick(): void {
  nowMs = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function start(): void {
  if (timerId === undefined && !paused && listeners.size > 0) {
    timerId = window.setInterval(tick, TICK_MS);
  }
}

function stop(): void {
  window.clearInterval(timerId);
  timerId = undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // 誰も購読していなかった間に進んだ分を、最初の描画で取り戻す
  if (!paused) {
    nowMs = Date.now();
  }
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
    }
  };
}

/** 今の時刻（Unix ミリ秒）。1 s ごとに変わる。止めている間は変わらない */
export function useClock(): number {
  return useSyncExternalStore(subscribe, () => nowMs);
}

/** 自動で動く表示を止める・再開する（WCAG 2.2.2）。再開すると、止めていた分も含めて今の値に戻る */
export function setClockPaused(value: boolean): void {
  paused = value;
  if (paused) {
    stop();
  } else {
    tick();
    start();
  }
}
