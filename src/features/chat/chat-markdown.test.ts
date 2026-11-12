import { describe, expect, it } from "vitest";

import {
  citationMark,
  placeCitationMarks,
  placeFlowLinks,
  renderChatMarkdown,
  revealPrefix,
  splitBlocks,
  splitFigures,
} from "@/features/chat/chat-markdown";
import { CONVERT_TIMEOUT_MS } from "@/test/samples";

function html(fragment: DocumentFragment): string {
  const div = document.createElement("div");
  div.append(fragment);
  return div.innerHTML;
}

describe("splitBlocks", () => {
  it("空行で塊に分け、書いている途中なら最後の塊は書きかけにする", () => {
    expect(splitBlocks("一段落目\n\n二段落", true)).toStrictEqual({
      blocks: ["一段落目\n"],
      tail: "二段落",
    });
    // 次の塊が始まるまでは、最後の塊が閉じたか分からない（続きが字下げのこともある）
    expect(splitBlocks("一段落目\n\n", true)).toStrictEqual({ blocks: [], tail: "一段落目\n\n" });
    expect(splitBlocks("一段落目\n\n二段落", false)).toStrictEqual({
      blocks: ["一段落目\n", "二段落"],
      tail: "",
    });
    expect(splitBlocks("", false)).toStrictEqual({ blocks: [], tail: "" });
  });

  it("書きかけの表は塊にしない", () => {
    const text = "結論です。\n\n| a | b |\n| - | - |\n| 1 |";
    expect(splitBlocks(text, true).tail).toBe("| a | b |\n| - | - |\n| 1 |");
  });

  it("コードの囲み・式の中と、字下げした続きの前の空行では区切らない", () => {
    const code = "前\n\n```\nx\n\ny\n```\n\n後";
    expect(splitBlocks(code, false).blocks).toStrictEqual(["前\n", "```\nx\n\ny\n```\n", "後"]);
    const math = "前\n\n$$\na\n\nb\n";
    expect(splitBlocks(math, true)).toStrictEqual({ blocks: ["前\n"], tail: "$$\na\n\nb\n" });
    const list = "- 項目\n\n  続き\n\n次";
    expect(splitBlocks(list, false).blocks).toStrictEqual(["- 項目\n\n  続き\n", "次"]);
  });
});

describe("splitFigures", () => {
  it("figure の囲みを図の部分にする", () => {
    const text = "止血帯を巻きます。\n\n```figure\ndoc:tourniquet.md#巻く位置\n```\n\n続き";
    expect(splitFigures(text)).toStrictEqual([
      { kind: "markdown", text: "止血帯を巻きます。\n\n" },
      { kind: "figure", source: "doc:tourniquet.md#巻く位置" },
      { kind: "markdown", text: "\n\n続き" },
    ]);
  });

  it("図がなければ本文だけ", () => {
    expect(splitFigures("本文")).toStrictEqual([{ kind: "markdown", text: "本文" }]);
    expect(splitFigures("")).toStrictEqual([]);
  });
});

describe("renderChatMarkdown", () => {
  it(
    "表と式をビューアと同じ形にする",
    async () => {
      const out = html(await renderChatMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n\n$x^2$"));
      expect(out).toContain("<table>");
      expect(out).toContain("<math");
    },
    CONVERT_TIMEOUT_MS,
  );

  it(
    "生の HTML とリンクを通さない",
    async () => {
      const out = html(
        await renderChatMarkdown(
          '<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[外部](https://example.com) と [内部](doc:a.md)',
        ),
      );
      expect(out).not.toContain("<script");
      expect(out).not.toContain("<img");
      expect(out).not.toContain("<a");
      expect(out).toContain("外部");
      expect(out).toContain("内部");
    },
    CONVERT_TIMEOUT_MS,
  );
});

describe("placeCitationMarks", () => {
  it(
    "変換と無害化を通った引用の印を、表の中でも部品を置く span に差し替える",
    async () => {
      const root = document.createElement("div");
      root.append(
        await renderChatMarkdown(
          `腕に巻く。${citationMark(0)}\n\n| a | b |\n| - | - |\n| 1 | 2${citationMark(1)} |`,
        ),
      );
      const slots = placeCitationMarks(root);
      expect(slots.map((s) => s.index)).toStrictEqual([0, 1]);
      expect(slots[0]?.slot.parentElement?.tagName).toBe("P");
      expect(slots[1]?.slot.parentElement?.tagName).toBe("TD");
      expect(root.textContent).not.toMatch(/[\uE000\uE001]/u);
    },
    CONVERT_TIMEOUT_MS,
  );
});

describe("revealPrefix", () => {
  it("引用の印と図の囲みの途中では切らない", () => {
    const text = `腕に巻く。${citationMark(12)}次`;
    // 印の途中（番号の 1 文字目まで）で切ると、印の手前までにする
    expect(revealPrefix(text, 7)).toBe("腕に巻く。");
    expect(revealPrefix(text, text.length - 1)).toBe(`腕に巻く。${citationMark(12)}`);
    const figure = "前\n\n```figure\ndoc:a.md#b\n```\n後";
    expect(revealPrefix(figure, 12)).toBe("前\n\n");
    expect(revealPrefix(figure, figure.length - 1)).toBe(figure.slice(0, -1));
  });
});

describe("placeFlowLinks", () => {
  it(
    "フローへのリンクだけを残してボタンの場所にし、ほかのリンクは文字にする",
    async () => {
      const root = document.createElement("div");
      root.append(
        await renderChatMarkdown("[痛みを抑える](flow:pain) と [外部](https://example.com)"),
      );
      const flows = placeFlowLinks(root);
      expect(flows.map(({ flowId, label }) => ({ flowId, label }))).toStrictEqual([
        { flowId: "pain", label: "痛みを抑える" },
      ]);
      expect(root.querySelector("a")).toBeNull();
      expect(root.textContent).toContain("外部");
    },
    CONVERT_TIMEOUT_MS,
  );
});
