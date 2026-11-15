import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revealWhenIdle } from "@/lib/reveal-when-idle";

function boxes(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => document.createElement("div"));
}

function revealed(elements: readonly HTMLElement[]): boolean[] {
  return elements.map((el) => el.style.contentVisibility === "visible");
}

// jsdom には requestIdleCallback が無いので、無いブラウザ（Safari）と同じ、時間を置いて呼ぶ経路を確かめる
describe("revealWhenIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("すぐには切り替えず、渡した順に 1 回に 1 つずつ切り替える", () => {
    const elements = boxes(3);
    revealWhenIdle(elements);
    expect(revealed(elements)).toStrictEqual([false, false, false]);
    vi.advanceTimersToNextTimer();
    expect(revealed(elements)).toStrictEqual([true, false, false]);
    vi.advanceTimersToNextTimer();
    expect(revealed(elements)).toStrictEqual([true, true, false]);
    vi.runAllTimers();
    expect(revealed(elements)).toStrictEqual([true, true, true]);
  });

  it("止めたら、残りは切り替えない", () => {
    const elements = boxes(3);
    const stop = revealWhenIdle(elements);
    vi.advanceTimersToNextTimer();
    stop();
    vi.runAllTimers();
    expect(revealed(elements)).toStrictEqual([true, false, false]);
  });

  it("切り替え済みの要素は飛ばす（呼び直しても、残りだけを進める）", () => {
    const elements = boxes(3);
    const [, second] = elements;
    if (second !== undefined) {
      second.style.contentVisibility = "visible";
    }
    revealWhenIdle(elements);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    expect(revealed(elements)).toStrictEqual([true, true, true]);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Chromium（Web 版の多くと、デスクトップ版の WebView2）は requestIdleCallback の経路を通る
describe("revealWhenIdle（requestIdleCallback のあるブラウザ）", () => {
  let callbacks: Map<number, () => void>;
  let nextHandle: number;

  /** 予約されている中でいちばん古いものを 1 つ呼ぶ。無ければ false */
  function runIdle(): boolean {
    const [first] = callbacks;
    if (first === undefined) {
      return false;
    }
    callbacks.delete(first[0]);
    first[1]();
    return true;
  }

  beforeEach(() => {
    callbacks = new Map();
    nextHandle = 1;
    vi.stubGlobal("requestIdleCallback", (callback: () => void): number => {
      callbacks.set(nextHandle, callback);
      return nextHandle++;
    });
    vi.stubGlobal("cancelIdleCallback", (handle: number): void => {
      callbacks.delete(handle);
    });
    // こちらの経路では、時間を置いて呼ぶほうを使わないことも確かめる
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("手の空いたときの 1 回ごとに、1 つだけ切り替える", () => {
    const elements = boxes(3);
    revealWhenIdle(elements);
    expect(revealed(elements)).toStrictEqual([false, false, false]);
    expect(callbacks.size).toBe(1);
    runIdle();
    expect(revealed(elements)).toStrictEqual([true, false, false]);
    expect(callbacks.size).toBe(1);
    runIdle();
    runIdle();
    expect(revealed(elements)).toStrictEqual([true, true, true]);
    // 全部を切り替えた後の 1 回で、次を予約せずに終わる
    expect(runIdle()).toBe(true);
    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("途中で止めたら、いま予約している分を取り消し、残りは切り替えない", () => {
    const elements = boxes(3);
    const stop = revealWhenIdle(elements);
    runIdle();
    expect(callbacks.size).toBe(1);
    stop();
    expect(callbacks.size).toBe(0);
    expect(runIdle()).toBe(false);
    expect(revealed(elements)).toStrictEqual([true, false, false]);
  });
});
