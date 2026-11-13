import { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAiSettings } from "@/features/chat/ai-settings";
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

  it("モデルは会話の最初の値を使い続け、Effort は今の設定を送る", async () => {
    const inputs = mockSend(false);
    await useChatStore.getState().send("q1", []);
    expect(useChatStore.getState().conversation).toStrictEqual({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    useAiSettings.setState({
      settings: { model: "claude-opus-5-5", effort: "low" },
      customEffort: true,
    });
    await useChatStore.getState().send("q2", []);
    expect(arg(inputs[1], "model")).toBe("claude-sonnet-5-5");
    expect(arg(inputs[1], "effort")).toBe("low");
    useAiSettings.setState({
      settings: { model: "claude-sonnet-5-5", effort: "medium" },
      customEffort: false,
    });
    await useChatStore.getState().reset();
    expect(useChatStore.getState().conversation).toBeNull();
    expect(useChatStore.getState().turns).toStrictEqual([]);
  });

  it("キャッシュの保温は、会話があって回答中でないときだけ送り、使った分を合計する", async () => {
    let keepAlives = 0;
    mockIPC((cmd) => {
      if (cmd === "ai_chat_send") {
        return { status: { kind: "completed" }, usage: USAGE, turnIndex: 0 };
      }
      if (cmd === "ai_chat_keep_alive") {
        keepAlives += 1;
        return { ...USAGE, cacheReadTokens: 40000 };
      }
      return null;
    });
    await useChatStore.getState().keepAliveNow();
    expect(keepAlives).toBe(0);
    await useChatStore.getState().send("q1", []);
    expect(useChatStore.getState().lastTurnEndAt).not.toBeNull();
    await useChatStore.getState().keepAliveNow();
    await useChatStore.getState().keepAliveNow();
    expect(keepAlives).toBe(2);
    expect(useChatStore.getState().keepAlive.count).toBe(2);
    expect(useChatStore.getState().keepAlive.usage.cacheReadTokens).toBe(80000);
    await useChatStore.getState().reset();
    expect(useChatStore.getState().keepAlive.count).toBe(0);
    expect(useChatStore.getState().lastRequestAt).toBeNull();
  });

  it("保温を待っている間に会話を消したら、その結果は足さない", async () => {
    // 保温の応答を、reset の後まで止めておく
    const gate: { release?: (usage: typeof USAGE) => void } = {};
    mockIPC((cmd) => {
      if (cmd === "ai_chat_send") {
        return { status: { kind: "completed" }, usage: USAGE, turnIndex: 0 };
      }
      if (cmd === "ai_chat_keep_alive") {
        return new Promise((resolve) => {
          gate.release = resolve;
        });
      }
      return null;
    });
    await useChatStore.getState().send("q1", []);
    const pending = useChatStore.getState().keepAliveNow();
    await useChatStore.getState().reset();
    gate.release?.(USAGE);
    await pending;
    expect(useChatStore.getState().keepAlive.count).toBe(0);
  });

  it("保温の予約の基準は、最後の要求の開始時刻にする", async () => {
    mockIPC((cmd, args) => {
      if (cmd !== "ai_chat_send") {
        return null;
      }
      const onEvent = arg(args, "onEvent");
      if (onEvent instanceof Channel) {
        onEvent.onmessage({ type: "request_started" });
      }
      return { status: { kind: "completed" }, usage: USAGE, turnIndex: 0 };
    });
    const before = Date.now();
    await useChatStore.getState().send("q1", []);
    const { lastRequestAt, lastTurnEndAt } = useChatStore.getState();
    expect(lastRequestAt).not.toBeNull();
    expect(lastRequestAt ?? 0).toBeGreaterThanOrEqual(before);
    expect(lastTurnEndAt ?? 0).toBeGreaterThanOrEqual(lastRequestAt ?? 0);
  });
});
