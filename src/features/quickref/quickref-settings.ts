// クイック表の表示（カード / 表）。settings のキー `quickref` に保存し、再起動しても残す。
// 「すべての組み合わせを表示」は保存しない（次に開いたとき MOD の絞り込みが効いていないように見えるため）。
import { create } from "zustand";

import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

export const QUICKREF_VIEWS = ["card", "table"] as const;
export type QuickrefView = (typeof QUICKREF_VIEWS)[number];

export interface QuickrefSettings {
  view: QuickrefView;
}

export const DEFAULT_QUICKREF_SETTINGS: QuickrefSettings = { view: "card" };

const SETTINGS_KEY = "quickref";

function isQuickrefView(value: unknown): value is QuickrefView {
  return QUICKREF_VIEWS.some((view) => view === value);
}

/** 保存された値を読む。不正な項目は既定値に戻す（古い版で保存した値などに備えるため）。 */
export function parseQuickrefSettings(value: unknown): QuickrefSettings {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const view = record["view"];
  return { view: isQuickrefView(view) ? view : DEFAULT_QUICKREF_SETTINGS.view };
}

interface QuickrefSettingsState {
  settings: QuickrefSettings;
  /** 利用者が変えたか。読み込みより先に変えられたとき、読み込んだ古い値で上書きしないため */
  changed: boolean;
  storageError: string | null;
  setView: (view: QuickrefView) => void;
}

export const useQuickrefSettings = create<QuickrefSettingsState>()((set) => ({
  settings: DEFAULT_QUICKREF_SETTINGS,
  changed: false,
  storageError: null,
  setView: (view) => {
    const settings = { view };
    set({ settings, changed: true });
    settingsSet(SETTINGS_KEY, settings).then(
      () => {
        set({ storageError: null });
      },
      (error: unknown) => {
        set({ storageError: errorMessage(error) });
      },
    );
  },
}));

/** 起動時に 1 回呼ぶ。force は、別のウィンドウで変えた値を拾うとき（小窓を出すたび）。 */
export async function loadQuickrefSettings(force = false): Promise<void> {
  try {
    const settings = parseQuickrefSettings(await settingsGet(SETTINGS_KEY));
    if (force || !useQuickrefSettings.getState().changed) {
      useQuickrefSettings.setState({ settings });
    }
  } catch (error: unknown) {
    useQuickrefSettings.setState({ storageError: errorMessage(error) });
  }
}
