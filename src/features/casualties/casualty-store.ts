// 負傷者の記録。本体はデスクトップ版は SQLite、Web 版は localStorage に置き、ここには画面に出す写しを持つ。
import { create } from "zustand";

import { loadModSettings } from "@/features/settings/mod-settings";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { CasualtyOp } from "@/lib/bindings/CasualtyOp";
import {
  casualtyApply,
  casualtyList,
  errorMessage,
  onCasualtiesChanged,
  onSettingsChanged,
} from "@/lib/tauri";

const MODS_SETTINGS_KEY = "mods";

interface CasualtyState {
  casualties: Casualty[];
  loaded: boolean;
  error: string | null;
}

export const useCasualties = create<CasualtyState>()(() => ({
  casualties: [],
  loaded: false,
  error: null,
}));

// 操作と読み直しは順に 1 つずつ行う。応答の順が入れ替わると、古い一覧で新しい記録が画面から消えるため
let queue: Promise<unknown> = Promise.resolve();

function enqueue(task: () => Promise<Casualty[]>): Promise<void> {
  const run = queue.then(task).then(
    (casualties) => {
      useCasualties.setState({ casualties, loaded: true, error: null });
    },
    (error: unknown) => {
      useCasualties.setState({ loaded: true, error: errorMessage(error) });
    },
  );
  queue = run;
  return run;
}

/**
 * 画面を開いたときと、もう一方のウィンドウが書いたときに読み直す。起動時に読まないのは、
 * Web 版の読み込みが検査のライブラリを連れてくるので、マニュアルを読むだけの人に待たせないため。
 */
export function loadCasualties(): Promise<void> {
  return enqueue(() => casualtyList());
}

/** 記録を書く。失敗は `error` に入り、画面に出す。 */
export function applyCasualtyOp(op: CasualtyOp): Promise<void> {
  return enqueue(() => casualtyApply(op));
}

/**
 * 起動時に 1 回呼ぶ。片方のウィンドウで書いたらもう片方にすぐ出す。
 * 使っている MOD も、カードの出し分けが古いまま残らないよう一緒に追う。
 */
export function startCasualtySync(): void {
  void onCasualtiesChanged(() => {
    void loadCasualties();
  }).catch(() => {
    // 受け取れなくても、次に自分で書いたときに全体がそろう
  });
  void onSettingsChanged((key) => {
    if (key === MODS_SETTINGS_KEY) {
      void loadModSettings();
    }
  }).catch(() => {
    // 受け取れなくても、小窓を出し直せば読み直す
  });
}
