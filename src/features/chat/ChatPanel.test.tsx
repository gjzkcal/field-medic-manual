import { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useAiKey } from "@/features/chat/ai-key";
import { useChatStore } from "@/features/chat/chat-store";
import { ChatPanelHost } from "@/features/chat/ChatPanel";
import { useContentSync } from "@/features/content/sync";
import type { ChatEvent } from "@/lib/bindings/ChatEvent";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import { axeViolations } from "@/test/axe";
import { CONVERT_TIMEOUT_MS } from "@/test/samples";

// 回答の Markdown の変換は、初めて使うときにライブラリを読み込むので、ほかのテストと並ぶと 1 秒を超えることがある
const RENDER_WAIT = { timeout: CONVERT_TIMEOUT_MS };

const USAGE = {
  inputTokens: 1200,
  outputTokens: 80,
  cacheReadTokens: 30000,
  cacheWriteTokens: 0,
  webSearches: 0,
};

const OUTLINE: DocOutline[] = [
  {
    id: "doc-tq",
    title: "止血帯",
    sourcePath: "bundle://manuals/tourniquet.md",
    meta: {
      modTarget: null,
      modChannel: null,
      modVersion: null,
      verifiedAt: null,
      tags: [],
      order: null,
      category: null,
      aceCommit: null,
      gameVersion: null,
    },
    headings: [],
  },
];

class NoopObserver {
  observe(): void {
    // jsdom は大きさと見え方を計算しないので、何も知らせない
  }
  unobserve(): void {
    // 同上
  }
  disconnect(): void {
    // 同上
  }
}

/** IPC の引数（オブジェクト）から 1 つの値を取り出す */
function arg(args: unknown, key: string): unknown {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? Object.fromEntries(Object.entries(args))[key]
    : undefined;
}

function doNothing(): void {
  // 答えが来るまで何もしない
}

interface Backend {
  send: unknown[];
  toolResult: unknown[];
  casualtyApply: unknown[];
}

const CASUALTY: Casualty = {
  id: "c1",
  name: "A",
  createdAtMs: Date.now() - 60_000,
  inPain: false,
  records: [],
};

/**
 * ai_chat_send が呼ばれたら、before を Channel に流す。after があれば、聞き返しの答え（ai_chat_tool_result）を待ってから流す。
 * Rust が聞き返しの答えを待ってから続きを送るのと同じ順にするため。
 */
function mockBackend(options: {
  keyStatus?: "set" | "missing";
  before?: ChatEvent[];
  after?: ChatEvent[];
}): Backend {
  const backend: Backend = { send: [], toolResult: [], casualtyApply: [] };
  let answered: () => void = doNothing;
  const waitAnswer = new Promise<void>((resolve) => {
    answered = resolve;
  });
  mockIPC(async (cmd, args) => {
    switch (cmd) {
      case "ai_key_status":
        return options.keyStatus ?? "set";
      case "doc_outline":
        return OUTLINE;
      case "casualty_list":
        return [CASUALTY];
      case "casualty_apply":
        backend.casualtyApply.push(args);
        return [CASUALTY];
      case "ai_chat_tool_result":
        backend.toolResult.push(args);
        answered();
        return null;
      case "ai_chat_send": {
        backend.send.push(args);
        const channel = arg(args, "onEvent");
        if (channel instanceof Channel) {
          for (const event of options.before ?? []) {
            channel.onmessage(event);
          }
          if (options.after !== undefined) {
            await waitAnswer;
            for (const event of options.after) {
              channel.onmessage(event);
            }
          }
        }
        return { status: { kind: "completed" }, usage: USAGE, turnIndex: 0 };
      }
      default:
        return null;
    }
  });
  return backend;
}

function renderPanel(): void {
  const router = createMemoryRouter(
    [
      { path: "/", element: <ChatPanelHost /> },
      { path: "/doc/:id", element: <p>ビューア</p> },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
}

async function ask(text: string): Promise<void> {
  const input = await screen.findByRole("textbox", { name: "AI への質問" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "質問を送る" }));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    // 広い画面（本文の横に並べる）として描く
    matches: true,
    media: query,
    addEventListener: (): void => {
      // 幅は変わらない
    },
    removeEventListener: (): void => {
      // 幅は変わらない
    },
  }));
  useContentSync.setState({
    state: {
      status: "done",
      result: { added: 0, updated: 0, unchanged: 1, removed: 0, failed: [], warnings: [] },
    },
  });
  useAiKey.setState({ status: null });
  useChatStore.setState({
    panelOpen: true,
    turns: [],
    busy: false,
    conversation: null,
    notice: null,
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.unstubAllGlobals();
});

describe("ChatPanel", () => {
  it("キーがなければ、設定へ案内する", async () => {
    mockBackend({ keyStatus: "missing" });
    renderPanel();
    expect(await screen.findByText("API キーが登録されていません")).toBeTruthy();
    expect(screen.getByRole("button", { name: "設定を開く" })).toBeTruthy();
  });

  it(
    "質問を送ると、回答・出典・トークン数を出す",
    async () => {
      const backend = mockBackend({
        before: [
          {
            type: "tool_activity",
            id: "t1",
            tool: "read_section",
            detail: "doc:tourniquet.md#巻く位置",
            state: "done",
          },
          {
            type: "citation",
            block: 2,
            citation: {
              kind: "manual",
              source: "doc:tourniquet.md#巻く位置",
              title: "止血帯 > 巻く位置",
              citedText: "傷より心臓に近い側",
            },
          },
          { type: "text", block: 2, text: "傷より**心臓に近い側**に巻きます。" },
          { type: "usage", usage: USAGE },
        ],
      });
      renderPanel();
      await ask("TQ はどこに巻く？");

      expect(await screen.findByText("心臓に近い側", {}, RENDER_WAIT)).toBeTruthy();
      expect(screen.getByText("節を読みました: 巻く位置")).toBeTruthy();
      // 引用の場所には、その場所の節のチップが文の中に入る。出典の一覧は本文の下にあり、既定で閉じている
      expect(await screen.findByRole("button", { name: "巻く位置" }, RENDER_WAIT)).toBeTruthy();
      expect(screen.queryByText(/\[1\]/u)).toBeNull();
      expect(screen.queryByRole("button", { name: "止血帯 > 巻く位置" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "出典 1 件" }));
      expect(await screen.findByRole("button", { name: "止血帯 > 巻く位置" })).toBeTruthy();
      // キャッシュから読んだ分（料金が 1 割）は、入力の合計と分けて出す
      expect(screen.getByText(/入力 1,200（キャッシュ 3\.0 万）・出力 80 トークン/u)).toBeTruthy();
      expect(screen.getByText("AI の回答です。根拠の節を確かめてください")).toBeTruthy();
      expect(screen.getByRole("button", { name: "回答をコピー" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "質問を直す" })).toBeTruthy();
      expect(backend.send).toHaveLength(1);
      expect(arg(backend.send[0], "input")).toMatchObject({
        text: "TQ はどこに巻く？",
        model: "claude-sonnet-5-5",
        effort: "medium",
      });
      expect(await axeViolations()).toStrictEqual([]);
    },
    CONVERT_TIMEOUT_MS * 2,
  );

  it(
    "聞き返しに選択肢で答えると、答えを Rust に返して続きを出す",
    async () => {
      const backend = mockBackend({
        before: [
          {
            type: "client_request",
            toolUseId: "ask1",
            request: {
              kind: "ask_user",
              question: "呼吸はありますか？",
              options: ["ある", "ない"],
              multiSelect: false,
            },
          },
        ],
        after: [{ type: "text", block: 1, text: "回復体位にします。" }],
      });
      renderPanel();
      await ask("意識がない");

      expect(await screen.findByText("呼吸はありますか？")).toBeTruthy();
      // 選択肢にない答えは、下の入力欄から送る
      expect(screen.getByRole("textbox", { name: "AI への答え" })).toBeTruthy();
      expect(await axeViolations()).toStrictEqual([]);
      fireEvent.click(screen.getByRole("radio", { name: /ある/u }));
      fireEvent.click(screen.getByRole("button", { name: "答える" }));

      await waitFor(() => {
        expect(backend.toolResult).toStrictEqual([
          { toolUseId: "ask1", result: { kind: "ask_user", answer: "ある" } },
        ]);
      });
      expect(await screen.findByText("回復体位にします。", {}, RENDER_WAIT)).toBeTruthy();
      expect(screen.getByText("呼吸はありますか？ → ある")).toBeTruthy();
    },
    CONVERT_TIMEOUT_MS * 2,
  );

  it(
    "記録の提案は承認のカードに出し、承認したら記録して結果を Rust に返す",
    async () => {
      const backend = mockBackend({
        before: [
          {
            type: "client_request",
            toolUseId: "p1",
            request: {
              kind: "casualty_propose",
              summary: "A にモルヒネを記録",
              ops: [{ action: "give_drug", casualty: "c1", drug: "morphine" }],
            },
          },
        ],
        after: [{ type: "text", block: 1, text: "記録しました。" }],
      });
      renderPanel();
      await ask("A にモルヒネ打った");

      const approve = await screen.findByRole("button", { name: "承認して記録する" });
      expect(screen.getByText("「A」に記録: モルヒネ")).toBeTruthy();
      expect(screen.getByText("記録の時刻は、承認した時刻になります")).toBeTruthy();
      expect(await axeViolations()).toStrictEqual([]);
      await waitFor(() => {
        expect(approve.hasAttribute("disabled")).toBe(false);
      });
      fireEvent.click(approve);

      await waitFor(() => {
        expect(backend.toolResult).toStrictEqual([
          { toolUseId: "p1", result: { kind: "casualty_propose", approved: true, error: null } },
        ]);
      });
      expect(backend.casualtyApply).toStrictEqual([
        { op: { op: "add_record", casualtyId: "c1", entry: { kind: "drug", drug: "morphine" } } },
      ]);
      expect(await screen.findByText("記録しました: A にモルヒネを記録")).toBeTruthy();
    },
    CONVERT_TIMEOUT_MS * 2,
  );

  it("却下したら記録せず、却下を返す", async () => {
    const backend = mockBackend({
      before: [
        {
          type: "client_request",
          toolUseId: "p1",
          request: {
            kind: "casualty_propose",
            summary: "全部消す",
            ops: [{ action: "clear_all" }],
          },
        },
      ],
      after: [],
    });
    renderPanel();
    await ask("全部消して");
    fireEvent.click(await screen.findByRole("button", { name: "却下" }));
    await waitFor(() => {
      expect(backend.toolResult).toStrictEqual([
        { toolUseId: "p1", result: { kind: "casualty_propose", approved: false, error: null } },
      ]);
    });
    expect(backend.casualtyApply).toStrictEqual([]);
  });

  it(
    "記録を読む要求には、画面が記録を文にして黙って答える",
    async () => {
      const backend = mockBackend({
        before: [{ type: "client_request", toolUseId: "r1", request: { kind: "casualty_read" } }],
        after: [{ type: "text", block: 1, text: "A さんは" }],
      });
      renderPanel();
      await ask("A の状態は？");
      await waitFor(() => {
        expect(backend.toolResult).toHaveLength(1);
      }, RENDER_WAIT);
      expect(backend.toolResult[0]).toMatchObject({
        toolUseId: "r1",
        result: { kind: "casualty_read", text: expect.stringContaining("負傷者「A」") as unknown },
      });
    },
    CONVERT_TIMEOUT_MS * 2,
  );

  it("失敗したら、理由を出す", async () => {
    mockIPC((cmd) => {
      if (cmd === "ai_key_status") {
        return "set";
      }
      if (cmd === "ai_chat_send") {
        return Promise.reject(new Error("API キーが使えません: invalid x-api-key"));
      }
      return cmd === "doc_outline" ? OUTLINE : null;
    });
    renderPanel();
    await ask("?");
    // コピーのボタンも空の alert を持つので、文で探す
    const message = await screen.findByText(/invalid x-api-key/u);
    expect(message.closest("[role=alert]")).not.toBeNull();
  });
});
