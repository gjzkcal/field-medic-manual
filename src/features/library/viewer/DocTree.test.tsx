import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { DocTree } from "@/features/library/viewer/DocTree";
import { activeMods, DEFAULT_MOD_SETTINGS } from "@/features/settings/mod-settings";
import type { DocOutline } from "@/lib/bindings/DocOutline";

afterEach(() => {
  cleanup();
});

function outline(id: string, title: string, category: string | null): DocOutline {
  return {
    id,
    title,
    sourcePath: `bundle://manuals/${id}.md`,
    meta: {
      modTarget: null,
      modChannel: null,
      modVersion: null,
      verifiedAt: null,
      aceCommit: null,
      gameVersion: null,
      tags: [],
      order: null,
      category,
    },
    headings: [
      { level: 2, title: `${title}の節`, anchor: "a", mods: [], withoutMods: [], hasBody: true },
    ],
  };
}

describe("DocTree", () => {
  it("分類ごとに見出しを付けてまとめ、分類のないものは末尾の「その他」にする", () => {
    render(
      <MemoryRouter>
        <DocTree
          outline={[
            outline("about", "この原稿の読み方", "はじめに"),
            outline("extra", "付録", null),
            outline("hemorrhage", "出血と止血", "症状/処置"),
            outline("airway", "気道管理", "症状/処置"),
          ]}
          currentId="hemorrhage"
          active={activeMods(DEFAULT_MOD_SETTINGS)}
          currentVisible={new Set(["a"])}
        />
      </MemoryRouter>,
    );

    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.firstElementChild?.textContent)).toEqual([
      "はじめに",
      "症状/処置",
      "その他",
    ]);
    const treatment = within(screen.getByRole("group", { name: "症状/処置" }));
    const link = (text: string): HTMLAnchorElement | null =>
      treatment.queryByText(text)?.closest("a") ?? null;
    expect(link("出血と止血")?.getAttribute("aria-current")).toBe("page");
    expect(link("気道管理")?.getAttribute("href")).toBe("/doc/airway");
    // 今の文書だけ見出しが開いている
    expect(link("出血と止血の節")).not.toBeNull();
    expect(link("気道管理の節")).toBeNull();
  });
});
