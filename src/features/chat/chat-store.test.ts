import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "@/features/chat/chat-store";

const USAGE = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
};

function arg(args: unknown, key: string): unknown {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? Object.fromEntries(Object.entries(args))[key]
    : undefined;
}

/** 送るたびに turnIndex を 0, 1, … と返す。failEdit なら編集（replaceFrom 付き）を失敗させる */
function mockSend(failEdit: boolean): unknown[] {
  const inputs: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "ai_chat_send") {
      return null;
    }
    const input = arg(args, "input");
    inputs.push(input);
    if (failEdit && arg(input, "replaceFrom") !== undefined) {
      return Promise.reject(new Error("通信できません"));
    }
    return { status: { kind: "completed" }, usage: USAGE, turnIndex: inputs.length - 1 };
  });
  return inputs;
}

beforeEach(() => {
  useChatStore.setState({ turns: [], busy: false, conversation: null, notice: null });
});

afterEach(() => {
  clearMocks();
});

describe("useChatStore", () => {
  it("編集すると、その質問から後ろを消して送り直す", async () => {
    const inputs = mockSend(false);
    await useChatStore.getState().send("q1", []);
    await useChatStore.getState().send("q2", []);
    const first = useChatStore.getState().turns[0];
    expect(first?.turnIndex).toBe(0);
    await useChatStore.getState().edit(first?.id ?? -1, "q1b");
    expect(useChatStore.getState().turns.map((t) => t.question)).toStrictEqual(["q1b"]);
    expect(inputs.at(-1)).toMatchObject({ text: "q1b", replaceFrom: 0 });
  });

  it("編集を送れなかったら、元の会話に戻して知らせる", async () => {
    mockSend(true);
    await useChatStore.getState().send("q1", []);
    await useChatStore.getState().send("q2", []);
    const first = useChatStore.getState().turns[0];
    await useChatStore.getState().edit(first?.id ?? -1, "q1b");
    expect(useChatStore.getState().turns.map((t) => t.question)).toStrictEqual(["q1", "q2"]);
    expect(useChatStore.getState().notice).toContain("元の会話に戻しました");
  });

  it("会話の最初の設定を、会話の間は使い続ける", async () => {
    mockSend(false);
    await useChatStore.getState().send("q1", []);
    expect(useChatStore.getState().conversation).toStrictEqual({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    await useChatStore.getState().reset();
    expect(useChatStore.getState().conversation).toBeNull();
    expect(useChatStore.getState().turns).toStrictEqual([]);
  });
});
