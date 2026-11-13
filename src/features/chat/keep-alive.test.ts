import { describe, expect, it } from "vitest";

import {
  KEEP_ALIVE_INTERVAL_MS,
  KEEP_ALIVE_WINDOW_MS,
  keepAliveDelayMs,
} from "@/features/chat/keep-alive";

describe("keepAliveDelayMs", () => {
  const end = 1_000_000;

  it("会話がなければ送らない", () => {
    expect(keepAliveDelayMs(end, null, null)).toBeNull();
  });

  it("最後の要求から間隔が過ぎるまで待つ", () => {
    expect(keepAliveDelayMs(end + 60_000, end, end)).toBe(KEEP_ALIVE_INTERVAL_MS - 60_000);
    expect(keepAliveDelayMs(end + KEEP_ALIVE_INTERVAL_MS + 5, end, end)).toBe(0);
  });

  it("保温の要求も最後の要求として数え、回答から 20 分で止める", () => {
    const lastKeepAlive = end + 4 * KEEP_ALIVE_INTERVAL_MS;
    expect(keepAliveDelayMs(lastKeepAlive, lastKeepAlive, end)).toBe(KEEP_ALIVE_INTERVAL_MS);
    const tooLate = end + KEEP_ALIVE_WINDOW_MS - KEEP_ALIVE_INTERVAL_MS + 1;
    expect(keepAliveDelayMs(tooLate, tooLate, end)).toBeNull();
  });

  it("パネルを閉じて長く置いた後に開いても、回答から 20 分を過ぎていれば送らない", () => {
    expect(keepAliveDelayMs(end + 30 * 60_000, end, end)).toBeNull();
  });
});
