import { describe, expect, it } from "vitest";

import { nestHeadings, type HeadingNode } from "@/features/library/viewer/heading-tree";

interface Item {
  level: number;
  title: string;
}

function shape(nodes: readonly HeadingNode<Item>[]): unknown[] {
  return nodes.map((n) =>
    n.children.length === 0 ? n.item.title : [n.item.title, shape(n.children)],
  );
}

describe("nestHeadings", () => {
  it("h3 を直前の h2 の下に入れ、次の h2 で上の段に戻る", () => {
    const items: Item[] = [
      { level: 1, title: "表題" },
      { level: 2, title: "A" },
      { level: 3, title: "A-1" },
      { level: 3, title: "A-2" },
      { level: 2, title: "B" },
    ];
    expect(shape(nestHeadings(items))).toEqual([["表題", [["A", ["A-1", "A-2"]], "B"]]]);
  });

  it("飛んだレベル（h1 の次に h3）や、h1 のない並びもすぐ上の見出しの下に入れる", () => {
    const items: Item[] = [
      { level: 3, title: "先頭の h3" },
      { level: 2, title: "A" },
      { level: 3, title: "A-1" },
    ];
    expect(shape(nestHeadings(items))).toEqual(["先頭の h3", ["A", ["A-1"]]]);
  });
});
