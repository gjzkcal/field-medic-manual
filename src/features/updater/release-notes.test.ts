import { describe, expect, it } from "vitest";

import { formatReleaseNotes } from "./release-notes";

describe("formatReleaseNotes", () => {
  it("種類の見出しを日本語にし、見出しの下の空行を詰める", () => {
    const notes = ["### Added", "", "- A", "- B", "", "### Fixed", "", "- C"].join("\n");
    expect(formatReleaseNotes(notes)).toBe(
      ["【追加】", "- A", "- B", "", "【修正】", "- C"].join("\n"),
    );
  });

  it("知らない見出しと本文はそのまま残す", () => {
    const notes = "### その他\n\n- D\n\n本文";
    expect(formatReleaseNotes(notes)).toBe(notes);
  });
});
