// AI チャットの表示の状態。会話は保存しない（アプリを閉じたら消える）。
// API に送り返す履歴は Rust が持ち、ここには画面に出すものだけを持つ。
import { create } from "zustand";

import { useAiSettings, type AiSettings } from "@/features/chat/ai-settings";
import { applyProposedOps } from "@/features/casualties/casualty-store";
import { casualtyBrief } from "@/features/chat/casualty-brief";
import {
  answerAsk,
  applyEvent,
  decideProposal,
  failTurn,
  finishTurn,
  newTurn,
  type AnswerItem,
  type ChatImageView,
  type ChatTurn,
} from "@/features/chat/chat-turn";
import { modsActive } from "@/features/triage/runner";
import { loadMedication } from "@/features/medication/bundle";
import { activeMods, useModSettings } from "@/features/settings/mod-settings";
import { useViewerSettings } from "@/features/settings/viewer-settings";
import type { ChatImage } from "@/lib/bindings/ChatImage";
import type { ChatUsage } from "@/lib/bindings/ChatUsage";
import type { ClientToolResult } from "@/lib/bindings/ClientToolResult";
import {
  aiChatCancel,
  aiChatKeepAlive,
  aiChatReset,
  aiChatSend,
  aiChatToolResult,
  casualtyList,
  errorMessage,
} from "@/lib/tauri";

/** 送る画像（Rust へは base64、表示は Blob URL） */
export interface PreparedImage {
  image: ChatImage;
  view: ChatImageView;
}

interface ChatState {
  panelOpen: boolean;
  turns: ChatTurn[];
  busy: boolean;
  /** 会話で使っている設定。モデルは会話の最初の値で固定（Rust も固定する）、effort は最後に送った値 */
  conversation: AiSettings | null;
  /** 編集した質問を送れなかったときの知らせ（元の会話に戻したことを伝える） */
  notice: string | null;
  /** 最後に API へ送った時刻（保温の要求を含む）。会話がなければ null */
  lastRequestAt: number | null;
  /** 最後の回答が終わった時刻 */
  lastTurnEndAt: number | null;
  /** キャッシュの保温で使った分（利用者に見せる。隠すと費用の説明がつかない） */
  keepAlive: { count: number; usage: ChatUsage };
  setPanelOpen: (open: boolean) => void;
  send: (text: string, images: readonly PreparedImage[]) => Promise<void>;
  edit: (turnId: number, text: string) => Promise<void>;
  answer: (toolUseId: string, answer: string) => Promise<void>;
  /** AI の記録の提案を承認（記録する）か却下する */
  decide: (toolUseId: string, approve: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => Promise<void>;
  /** 会話のキャッシュの期限を延ばす（keep-alive.ts の間隔で画面が呼ぶ） */
  keepAliveNow: () => Promise<void>;
}

const NO_USAGE: ChatUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
};

function addUsage(a: ChatUsage, b: ChatUsage): ChatUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

let nextTurnId = 1;
/** 会話を消すたびに増やす。消す前に出した保温の結果を、新しい会話に足さないため */
let conversationGeneration = 0;

async function sendResult(toolUseId: string, result: ClientToolResult): Promise<void> {
  try {
    await aiChatToolResult(toolUseId, result);
  } catch {
    // 待っている回答が止められた後に答えたときは、もう届ける先がない
  }
}

/** AI が負傷者の記録を読みたいとき。負傷者の画面と同じ計算をして、文で返す。 */
async function answerCasualtyRead(toolUseId: string): Promise<void> {
  let text: string;
  try {
    const [casualties, medication] = await Promise.all([casualtyList(), loadMedication()]);
    text = casualtyBrief({
      casualties,
      medication,
      circulation: modsActive(["circulation"], activeMods(useModSettings.getState().settings)),
      overdoseLine: useViewerSettings.getState().settings.overdoseLine,
      nowMs: Date.now(),
    });
  } catch (error: unknown) {
    text = `負傷者の記録を読めませんでした: ${errorMessage(error)}`;
  }
  await sendResult(toolUseId, { kind: "casualty_read", text });
}

function revokeImages(turns: readonly ChatTurn[]): void {
  for (const turn of turns) {
    for (const image of turn.images) {
      URL.revokeObjectURL(image.url);
    }
  }
}

export const useChatStore = create<ChatState>()((set, get) => {
  function updateTurn(id: number, update: (turn: ChatTurn) => ChatTurn): void {
    set((state) => ({ turns: state.turns.map((t) => (t.id === id ? update(t) : t)) }));
  }

  /** 1 回の質問を送り、終わった状態を返す。 */
  async function run(
    text: string,
    images: readonly PreparedImage[],
    replaceFrom: number | null,
  ): Promise<ChatTurn["state"]> {
    // モデルは会話の最初の値（Rust が固定する）。effort は今の設定で、Rust が次の質問から効かせる
    const current = useAiSettings.getState().settings;
    const settings: AiSettings = {
      model: get().conversation?.model ?? current.model,
      effort: current.effort,
    };
    const turn = newTurn(
      nextTurnId++,
      text,
      images.map((i) => i.view),
    );
    set((state) => ({
      turns: [...state.turns, turn],
      busy: true,
      conversation: settings,
      notice: null,
    }));
    try {
      const result = await aiChatSend(
        {
          text,
          images: images.map((i) => i.image),
          model: settings.model,
          effort: settings.effort,
          mods: useModSettings.getState().settings.enabled,
          ...(replaceFrom === null ? {} : { replaceFrom }),
        },
        (event) => {
          updateTurn(turn.id, (t) => applyEvent(t, event));
          if (event.type === "client_request" && event.request.kind === "casualty_read") {
            void answerCasualtyRead(event.toolUseId);
          }
          // キャッシュの期限は要求の開始から数えるので、ツールの往復ごとの最後の要求の開始を覚える
          if (event.type === "request_started") {
            set({ lastRequestAt: Date.now() });
          }
        },
      );
      const finished = finishTurn(turn, result);
      updateTurn(turn.id, (t) => finishTurn(t, result));
      return finished.state;
    } catch (error: unknown) {
      updateTurn(turn.id, (t) => failTurn(t, errorMessage(error)));
      return "error";
    } finally {
      const now = Date.now();
      // 要求の開始が届かなかったとき（送る前の失敗）だけ、終わった時刻で代える
      set({ busy: false, lastTurnEndAt: now, lastRequestAt: get().lastRequestAt ?? now });
    }
  }

  return {
    panelOpen: false,
    turns: [],
    busy: false,
    conversation: null,
    notice: null,
    lastRequestAt: null,
    lastTurnEndAt: null,
    keepAlive: { count: 0, usage: NO_USAGE },
    setPanelOpen: (open) => {
      set({ panelOpen: open });
    },
    send: async (text, images) => {
      if (get().busy) {
        return;
      }
      await run(text, images, null);
    },
    edit: async (turnId, text) => {
      const before = get().turns;
      const index = before.findIndex((t) => t.id === turnId);
      const turnIndex = before[index]?.turnIndex ?? null;
      if (get().busy || turnIndex === null) {
        return;
      }
      // 編集した質問から後ろを消して送り直す（Rust も同じ位置で履歴を切る）
      set({ turns: before.slice(0, index) });
      const state = await run(text, [], turnIndex);
      if (state === "done" || state === "truncated") {
        revokeImages(before.slice(index));
        return;
      }
      // 送れなかったときは Rust の会話も元のままなので、表示も元に戻す
      set({
        turns: before,
        notice: "編集した質問を送れなかったので、元の会話に戻しました",
      });
    },
    answer: async (toolUseId, answer) => {
      const turn = get().turns.find((t) =>
        t.items.some((i) => i.kind === "ask" && i.toolUseId === toolUseId),
      );
      if (turn === undefined) {
        return;
      }
      updateTurn(turn.id, (t) => answerAsk(t, toolUseId, answer));
      await sendResult(toolUseId, { kind: "ask_user", answer });
    },
    decide: async (toolUseId, approve) => {
      const turn = get().turns.find((t) =>
        t.items.some((i) => i.kind === "propose" && i.toolUseId === toolUseId),
      );
      const item = turn?.items.find(
        (i): i is Extract<AnswerItem, { kind: "propose" }> =>
          i.kind === "propose" && i.toolUseId === toolUseId,
      );
      if (turn === undefined || item?.status !== "pending") {
        return;
      }
      if (!approve) {
        updateTurn(turn.id, (t) => decideProposal(t, toolUseId, "rejected"));
        await sendResult(toolUseId, { kind: "casualty_propose", approved: false, error: null });
        return;
      }
      updateTurn(turn.id, (t) => decideProposal(t, toolUseId, "applying"));
      const { error } = await applyProposedOps(item.ops);
      updateTurn(turn.id, (t) =>
        decideProposal(t, toolUseId, error === null ? "approved" : "failed", error),
      );
      await sendResult(toolUseId, { kind: "casualty_propose", approved: true, error });
    },
    cancel: async () => {
      await aiChatCancel().catch(() => {
        // 止められなくても、回答が終われば元に戻る
      });
    },
    reset: async () => {
      conversationGeneration += 1;
      revokeImages(get().turns);
      set({
        turns: [],
        conversation: null,
        notice: null,
        lastRequestAt: null,
        lastTurnEndAt: null,
        keepAlive: { count: 0, usage: NO_USAGE },
      });
      await aiChatReset().catch(() => {
        // Rust の会話が残っても、次の質問で同じ会話に続くだけ
      });
    },
    keepAliveNow: async () => {
      if (get().busy || get().conversation === null) {
        return;
      }
      // 送った時刻を先に記録する。期限は要求の開始から数えるので、次の保温もそこから測る
      set({ lastRequestAt: Date.now() });
      const generation = conversationGeneration;
      try {
        const usage = await aiChatKeepAlive();
        // 待っている間に会話を消していたら、消した会話の分を新しい会話に足さない
        if (usage !== null && generation === conversationGeneration) {
          set((state) => ({
            keepAlive: {
              count: state.keepAlive.count + 1,
              usage: addUsage(state.keepAlive.usage, usage),
            },
          }));
        }
      } catch {
        // 延ばせなくても、次の質問で書き直すだけ。保温の失敗で画面を止めない
      }
    },
  };
});
