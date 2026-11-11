// API キーの登録の状態。キーそのものは Rust から返ってこない（画面に置かないため）。
// チャットのパネルと設定画面の両方が見るので、ストアにして、登録・削除のたびに読み直す。
import { create } from "zustand";

import type { AiKeyStatus } from "@/lib/bindings/AiKeyStatus";
import { aiKeyClear, aiKeySet, aiKeyStatus } from "@/lib/tauri";

interface AiKeyState {
  /** 読み終わるまでは null */
  status: AiKeyStatus | null;
  refresh: () => Promise<void>;
  save: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useAiKey = create<AiKeyState>()((set) => ({
  status: null,
  refresh: async () => {
    try {
      set({ status: await aiKeyStatus() });
    } catch {
      set({ status: "unavailable" });
    }
  },
  save: async (key) => {
    await aiKeySet(key);
    set({ status: "set" });
  },
  clear: async () => {
    await aiKeyClear();
    set({ status: "missing" });
  },
}));
