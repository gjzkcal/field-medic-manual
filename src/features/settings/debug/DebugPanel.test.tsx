import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MARK_END, MARK_START } from "@/features/search/snippet";
import { DebugPanel } from "@/features/settings/debug/DebugPanel";

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("DebugPanel", () => {
  it("一覧・同義語・検索結果を表示する", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "doc_list":
          return [
            {
              id: "d1",
              title: "止血帯",
              sourceType: "markdown",
              sourcePath: "sample://tourniquet",
              meta: {
                modTarget: "general",
                modChannel: null,
                modVersion: null,
                verifiedAt: null,
                tags: ["止血帯"],
              },
              sectionCount: 2,
              createdAt: "2026-09-25T00:00:00.000Z",
              updatedAt: "2026-09-25T00:00:00.000Z",
            },
          ];
        case "tag_list":
          return [{ name: "止血帯", documentCount: 1, sectionCount: 0 }];
        case "synonym_list":
          return [{ id: 1, terms: ["止血帯", "TQ"], note: null, updatedAt: "x" }];
        case "search_query":
          return [
            {
              kind: "section",
              id: 1,
              title: "止血帯を使う",
              snippet: `四肢の${MARK_START}止血帯${MARK_END}`,
              score: 1,
              documentId: "d1",
              documentTitle: "止血帯",
              anchor: "use-tourniquet",
              synonymOnly: false,
            },
          ];
        default:
          return undefined;
      }
    });

    render(<DebugPanel />);

    expect(await screen.findByText("止血帯 = TQ")).toBeDefined();
    expect(await screen.findByText("止血帯を使う")).toBeDefined();
    expect((await screen.findByText("止血帯", { selector: "mark" })).tagName).toBe("MARK");
  });
});
