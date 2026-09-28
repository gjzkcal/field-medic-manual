import { describe, expect, it } from "vitest";

import { formatReleaseDate } from "./release-date";

describe("formatReleaseDate", () => {
  it("Rust の time の表記を JST にする", () => {
    expect(formatReleaseDate("2026-09-30 12:00:00.0 +00:00:00")).toBe("2026/09/30 21:00 JST");
    expect(formatReleaseDate("2026-09-30 12:00:00 -02:30")).toBe("2026/09/30 23:30 JST");
  });

  it("RFC 3339 も JST にする", () => {
    expect(formatReleaseDate("2026-09-30T15:30:00Z")).toBe("2026/10/01 00:30 JST");
  });

  it("無い・読めないときは null", () => {
    expect(formatReleaseDate(null)).toBeNull();
    expect(formatReleaseDate("そのうち")).toBeNull();
  });
});
