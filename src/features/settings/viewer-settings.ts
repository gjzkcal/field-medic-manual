// ビューアの表示設定（文字サイズ・行間）。settings テーブルのキー `viewer` に保存し、再起動しても残す。
import { create } from "zustand";

import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

export const FONT_SIZES = ["s", "m", "l", "xl"] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export const LINE_HEIGHTS = ["normal", "relaxed", "loose"] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

export interface ViewerSettings {
  fontSize: FontSize;
  lineHeight: LineHeight;
}

// ゲームの横で目を離しながら読むので、既定でも一般的な本文（16px）より大きくする
export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = { fontSize: "m", lineHeight: "relaxed" };

export const FONT_SIZE_PX: Record<FontSize, number> = { s: 16, m: 18, l: 20, xl: 24 };
export const FONT_SIZE_LABEL: Record<FontSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };
export const LINE_HEIGHT_VALUE: Record<LineHeight, number> = {
  normal: 1.6,
  relaxed: 1.8,
  loose: 2,
};
export const LINE_HEIGHT_LABEL: Record<LineHeight, string> = {
  normal: "標準",
  relaxed: "広め",
  loose: "最大",
};

const SETTINGS_KEY = "viewer";

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return list.find((item) => item === value);
}

/** 保存された値を読む。項目ごとに検査し、不正な項目だけ既定値に戻す（1 項目の誤りで他の設定を失わないため）。 */
export function parseViewerSettings(value: unknown): ViewerSettings {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  return {
    fontSize: oneOf(FONT_SIZES, record["fontSize"]) ?? DEFAULT_VIEWER_SETTINGS.fontSize,
    lineHeight: oneOf(LINE_HEIGHTS, record["lineHeight"]) ?? DEFAULT_VIEWER_SETTINGS.lineHeight,
  };
}

interface ViewerSettingsState {
  settings: ViewerSettings;
  /** 利用者が変えたか。読み込みより先に変えられたとき、読み込んだ古い値で上書きしないため */
  changed: boolean;
  storageError: string | null;
  update: (patch: Partial<ViewerSettings>) => void;
}

export const useViewerSettings = create<ViewerSettingsState>()((set, get) => ({
  settings: DEFAULT_VIEWER_SETTINGS,
  changed: false,
  storageError: null,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
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

/** 保存した設定を読み込む。起動時に 1 回呼ぶ。読めなければ既定値のまま表示を続ける（設定のために閲覧を止めない）。 */
export async function loadViewerSettings(): Promise<void> {
  try {
    const settings = parseViewerSettings(await settingsGet(SETTINGS_KEY));
    if (!useViewerSettings.getState().changed) {
      useViewerSettings.setState({ settings });
    }
  } catch (error: unknown) {
    useViewerSettings.setState({ storageError: errorMessage(error) });
  }
}
