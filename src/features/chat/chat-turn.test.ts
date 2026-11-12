import { describe, expect, it } from "vitest";

import {
  answerForCopy,
  answerText,
  applyEvent,
  chipLabel,
  citationUrl,
  decideProposal,
  finishTurn,
  mergeTextRun,
  mergeWithMarks,
  numberMarks,
  newTurn,
  turnCitations,
  type ChatTurn,
  type TextItem,
} from "@/features/chat/chat-turn";
import { splitCitationMarks } from "@/features/chat/chat-markdown";
import { parseAiSettings } from "@/features/chat/ai-settings";
import type { ChatCitation } from "@/lib/bindings/ChatCitation";
import type { ChatEvent } from "@/lib/bindings/ChatEvent";

const TQ: ChatCitation = {
  kind: "manual",
  source: "doc:tourniquet.md#巻く位置",
  title: "止血帯 > 巻く位置",
  citedText: "傷より心臓に近い側",
};
const WEB: ChatCitation = {
  kind: "web",
  url: "https://anvil.acemod.org/dev/components/medical/",
  title: "Medical",
  citedText: "TQ",
};
const USAGE = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  webSearches: 0,
};

function apply(events: ChatEvent[]): ChatTurn {
  return events.reduce((turn, event) => applyEvent(turn, event), newTurn(1, "TQ は？", []));
}

describe("applyEvent", () => {
  it("同じブロックの本文はつなげ、ブロックが変われば分ける", () => {
    const turn = apply([
      { type: "thinking", block: 0, text: "考" },
      { type: "thinking", block: 0, text: "える" },
      { type: "text", block: 2, text: "腕に" },
      { type: "text", block: 2, text: "巻く" },
      { type: "text", block: 3, text: "。" },
    ]);
    expect(turn.items).toStrictEqual([
      { kind: "thinking", block: 0, text: "考える" },
      { kind: "text", block: 2, text: "腕に巻く", citations: [] },
      { kind: "text", block: 3, text: "。", citations: [] },
    ]);
    expect(answerText(turn)).toBe("腕に巻く。");
  });

  it("本文より先に届いた引用も、そのブロックに付ける", () => {
    const turn = apply([
      { type: "citation", block: 1, citation: TQ },
      { type: "text", block: 1, text: "巻く" },
    ]);
    expect(turn.items).toStrictEqual([{ kind: "text", block: 1, text: "巻く", citations: [TQ] }]);
  });

  it("ツールの様子は id ごとに更新し、終わりの知らせに語がなければ始まりの語を残す", () => {
    const turn = apply([
      { type: "tool_activity", id: "s1", tool: "web_search", detail: "TQ", state: "running" },
      { type: "tool_activity", id: "s1", tool: "web_search", detail: "", state: "done" },
    ]);
    expect(turn.items).toStrictEqual([
      { kind: "tool", id: "s1", tool: "web_search", detail: "TQ", state: "done" },
    ]);
  });

  it("聞き返し・知らせ・トークン数を持つ", () => {
    const turn = apply([
      {
        type: "client_request",
        toolUseId: "t1",
        request: {
          kind: "ask_user",
          question: "呼吸は？",
          options: ["ある", "ない"],
          multiSelect: false,
        },
      },
      { type: "notice", notice: "tool_limit_reached" },
      { type: "notice", notice: "tool_limit_reached" },
      { type: "usage", usage: USAGE },
    ]);
    expect(turn.items[0]).toMatchObject({ kind: "ask", question: "呼吸は？", answer: null });
    expect(turn.notices).toStrictEqual(["tool_limit_reached"]);
    expect(turn.usage).toStrictEqual(USAGE);
  });
});

describe("finishTurn", () => {
  it("結果の種類で状態と知らせを決める", () => {
    const turn = newTurn(1, "?", []);
    expect(
      finishTurn(turn, { status: { kind: "completed" }, usage: USAGE, turnIndex: 0 }),
    ).toMatchObject({
      state: "done",
      turnIndex: 0,
    });
    const refused = finishTurn(turn, {
      status: { kind: "refused", category: "bio", explanation: null },
      usage: USAGE,
      turnIndex: null,
    });
    expect(refused.state).toBe("refused");
    expect(refused.message).toContain("答えられませんでした");
    expect(
      finishTurn(turn, { status: { kind: "cancelled" }, usage: USAGE, turnIndex: null }).state,
    ).toBe("cancelled");
  });
});

describe("出典とコピー", () => {
  it("出典は重複を除いて届いた順に並べる", () => {
    const turn = apply([
      { type: "citation", block: 0, citation: TQ },
      { type: "citation", block: 1, citation: TQ },
      { type: "citation", block: 1, citation: WEB },
    ]);
    expect(turnCitations(turn)).toStrictEqual([TQ, WEB]);
  });

  it("原稿の出典は Web 版の URL にする", () => {
    expect(citationUrl(TQ)).toMatch(/\/doc\/tourniquet#%E5%B7%BB%E3%81%8F%E4%BD%8D%E7%BD%AE$/u);
    expect(citationUrl(WEB)).toBe(WEB.url);
    expect(citationUrl({ ...TQ, source: "flow:massive-bleeding" })).toMatch(
      /\/triage\/massive-bleeding$/u,
    );
  });

  it("コピーする文は番号付きの本文と出典の一覧で、図の囲みは外す", () => {
    const turn = apply([
      { type: "citation", block: 0, citation: TQ },
      { type: "text", block: 0, text: "腕に巻く。" },
      { type: "text", block: 1, text: "\n\n```figure\ndoc:tourniquet.md#巻く位置\n```\n" },
    ]);
    const copied = answerForCopy(turn);
    expect(copied).toMatch(
      /^腕に巻く。\[1\]\n\n出典:\n\[1\] 止血帯 > 巻く位置: https:\/\/.+\/doc\/tourniquet#/u,
    );
    expect(copied).not.toContain("figure");
  });
});

describe("mergeTextRun", () => {
  const items: TextItem[] = [
    { kind: "text", block: 0, text: "結論です。\n\n- ", citations: [] },
    { kind: "text", block: 1, text: "腕と脚に巻けます。\n", citations: [TQ, WEB, TQ] },
    { kind: "text", block: 2, text: "- 胸には巻けません。", citations: [TQ] },
  ];

  it("ブロックをつなぎ、引用の付いたブロックの終わり（改行の前）に番号を入れる", () => {
    const text = mergeTextRun(
      items,
      numberMarks((c) => (c.kind === "manual" ? 1 : 2)),
    );
    expect(text).toBe("結論です。\n\n- 腕と脚に巻けます。[1][2]\n- 胸には巻けません。[1]");
  });

  it("画面に出す本文には場所ごとの印を入れ、その場所で引いた出典を持つ", () => {
    const { text, marks } = mergeWithMarks(items);
    expect(splitCitationMarks(text)).toStrictEqual([
      "結論です。\n\n- 腕と脚に巻けます。",
      0,
      "\n- 胸には巻けません。",
      1,
    ]);
    expect(marks).toStrictEqual([[TQ, WEB, TQ], [TQ]]);
  });
});

describe("parseAiSettings", () => {
  it("知らない値は既定値にする", () => {
    expect(parseAiSettings({ model: "claude-opus-5-5", effort: "max" })).toStrictEqual({
      model: "claude-opus-5-5",
      effort: "max",
    });
    expect(parseAiSettings({ model: "gpt", effort: 3 })).toStrictEqual({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    expect(parseAiSettings(null)).toStrictEqual({ model: "claude-sonnet-5-5", effort: "medium" });
  });
});

describe("負傷者の記録とフロー", () => {
  it("記録の提案はカードとして足し、記録を読む要求は表示に足さない", () => {
    const turn = apply([
      { type: "client_request", toolUseId: "r1", request: { kind: "casualty_read" } },
      {
        type: "client_request",
        toolUseId: "p1",
        request: {
          kind: "casualty_propose",
          summary: "A にモルヒネ",
          ops: [{ action: "clear_all" }],
        },
      },
    ]);
    expect(turn.items).toStrictEqual([
      {
        kind: "propose",
        toolUseId: "p1",
        summary: "A にモルヒネ",
        ops: [{ action: "clear_all" }],
        status: "pending",
        error: null,
      },
    ]);
    expect(decideProposal(turn, "p1", "failed", "上限").items[0]).toMatchObject({
      status: "failed",
      error: "上限",
    });
  });

  it("コピーする文では、フローへのリンクを Web 版の URL にする", () => {
    const turn = apply([
      { type: "text", block: 0, text: "[痛みを抑える](flow:pain)を開いてください。" },
    ]);
    expect(answerForCopy(turn)).toMatch(
      /^痛みを抑える（https:\/\/.+\/triage\/pain）を開いてください。$/u,
    );
  });
});

describe("chipLabel", () => {
  it("見出しの最後の段にし、長ければクイック表は「クイック表」、ほかは頭を残して縮める", () => {
    expect(chipLabel(TQ)).toBe("巻く位置");
    expect(
      chipLabel({
        ...TQ,
        source: "quickref:pain",
        title: "クイック表 > 意識があって痛みがある（画面が白く点滅する）",
      }),
    ).toBe("クイック表");
    expect(chipLabel({ ...TQ, title: "痛みと抑え方 > Circulation を入れている場合" })).toBe(
      "Circulation…",
    );
    expect(chipLabel({ ...TQ, source: "quickref:x", title: "クイック表 > 出血" })).toBe("出血");
  });
});
