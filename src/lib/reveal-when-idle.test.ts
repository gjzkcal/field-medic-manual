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
