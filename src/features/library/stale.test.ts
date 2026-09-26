import { describe, expect, it } from "vitest";

import { daysSinceVerified, isStale, todayJst } from "@/features/library/stale";

describe("todayJst", () => {
  it("UTC の 15:00 で JST の日付が変わる", () => {
    expect(todayJst(new Date("2026-09-25T14:59:59Z"))).toBe("2026-09-25");
    expect(todayJst(new Date("2026-09-25T15:00:00Z"))).toBe("2026-09-26");
  });
});

describe("isStale", () => {
  // JST 2026-12-24 00:00 = 確認日 2026-09-25 から 90 日目
  const day90 = new Date("2026-12-23T15:00:00Z");

  it("90 日目までは古くない、91 日目から古い", () => {
    expect(daysSinceVerified("2026-09-25", day90)).toBe(90);
    expect(isStale("2026-09-25", day90)).toBe(false);
    expect(isStale("2026-09-25", new Date("2026-12-24T15:00:00Z"))).toBe(true);
  });

  it("JST の日付で数える（UTC ではまだ前日でも JST で日が変わっていれば 1 日進む）", () => {
    expect(daysSinceVerified("2026-09-25", new Date("2026-09-25T14:59:59Z"))).toBe(0);
    expect(daysSinceVerified("2026-09-25", new Date("2026-09-25T15:00:00Z"))).toBe(1);
  });

  it("確認日がない・読めないものは古い扱い", () => {
    expect(isStale(null, day90)).toBe(true);
    expect(isStale("いつか", day90)).toBe(true);
  });
});
