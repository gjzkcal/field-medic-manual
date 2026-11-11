// AI チャットの表示の状態。会話は保存しない（アプリを閉じたら消える）。
// API に送り返す履歴は Rust が持ち、ここには画面に出すものだけを持つ。
import { create } from "zustand";

import { useAiSettings, type AiSettings } from "@/features/chat/ai-settings";
import {
  answerAsk,
  applyEvent,
  failTurn,
  finishTurn,
  newTurn,
  type ChatImageView,
  type ChatTurn,
} from "@/features/chat/chat-turn";
import { useModSettings } from "@/features/settings/mod-settings";
import type { ChatImage } from "@/lib/bindings/ChatImage";
import { aiChatCancel, aiChatReset, aiChatSend, aiChatToolResult, errorMessage } from "@/lib/tauri";

/** 送る画像（Rust へは base64、表示は Blob URL） */
export interface PreparedImage {
  image: ChatImage;
  view: ChatImageView;
}

interface ChatState {
  panelOpen: boolean;
  turns: ChatTurn[];
  busy: boolean;
  /** 会話の最初の質問のときの設定。Rust は会話の間これを使うので、設定を変えても次の会話まで効かない */
  conversation: AiSettings | null;
  /** 編集した質問を送れなかったときの知らせ（元の会話に戻したことを伝える） */
  notice: string | null;
  setPanelOpen: (open: boolean) => void;
  send: (text: string, images: readonly PreparedImage[]) => Promise<void>;
  edit: (turnId: number, text: string) => Promise<void>;
  answer: (toolUseId: string, answer: string) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => Promise<void>;
}

let nextTurnId = 1;

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
    const settings = get().conversation ?? useAiSettings.getState().settings;
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
        },
      );
      const finished = finishTurn(turn, result);
      updateTurn(turn.id, (t) => finishTurn(t, result));
      return finished.state;
    } catch (error: unknown) {
      updateTurn(turn.id, (t) => failTurn(t, errorMessage(error)));
      return "error";
    } finally {
      set({ busy: false });
    }
  }

  return {
    panelOpen: false,
    turns: [],
    busy: false,
    conversation: null,
    notice: null,
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
      try {
        await aiChatToolResult(toolUseId, { kind: "ask_user", answer });
      } catch {
        // 待っている回答が止められた後に答えたときは、もう届ける先がない
      }
    },
    cancel: async () => {
      await aiChatCancel().catch(() => {
        // 止められなくても、回答が終われば元に戻る
      });
    },
    reset: async () => {
      revokeImages(get().turns);
      set({ turns: [], conversation: null, notice: null });
      await aiChatReset().catch(() => {
        // Rust の会話が残っても、次の質問で同じ会話に続くだけ
      });
    },
  };
});
