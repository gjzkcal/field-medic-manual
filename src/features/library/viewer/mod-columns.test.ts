import { describe, expect, it } from "vitest";

import { hideModColumns } from "@/features/library/viewer/mod-columns";
import { activeMods } from "@/features/settings/mod-settings";

function table(rows: string[][]): HTMLTableElement {
  const columns = [
    { mods: [], withoutMods: [] },
    { mods: ["circulation", "breathing"], withoutMods: [] },
    { mods: ["circulation"], withoutMods: ["breathing"] },
    { mods: [], withoutMods: ["circulation"] },
  ];
  const el = document.createElement("table");
  el.setAttribute("data-mod-columns", JSON.stringify(columns));
  for (const cells of rows) {
    const tr = el.insertRow();
    for (const text of cells) {
      tr.insertCell().textContent = text;
    }
  }
  return el;
}

const texts = (el: HTMLTableElement): string[][] =>
  Array.from(el.rows, (row) => Array.from(row.cells, (cell) => cell.textContent));

describe("hideModColumns", () => {
  it("合わない組み合わせの列を消し、「同左」は左のセルの中身にしてから消す", () => {
    const el = table([
      ["場面", "普段", "Circulation だけ", "Core だけ"],
      ["通常", "0.3", "同左", "0.3"],
      ["血液", "（判定）", "（同左）", "0"],
    ]);
    hideModColumns(el, activeMods({ enabled: ["circulation"] }));
    expect(texts(el)).toEqual([
      ["場面", "Circulation だけ"],
      ["通常", "0.3"],
      ["血液", "（判定）"],
    ]);
  });

  it("消す列がなければ「同左」もそのまま", () => {
    const el = table([["通常", "0.3", "同左", "0.3"]]);
    el.setAttribute("data-mod-columns", "[]");
    hideModColumns(el, activeMods({ enabled: [] }));
    expect(texts(el)).toEqual([["通常", "0.3", "同左", "0.3"]]);
  });
});
