// 表示設定（テーマ・本文の文字サイズ・行間と、トリアージのキー操作）。settings テーブルのキー `viewer` に保存し、再起動しても残す。
import { create } from "zustand";

import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

export const FONT_SIZES = ["s", "m", "l", "xl"] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export const LINE_HEIGHTS = ["normal", "relaxed", "loose"] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];
/** system は OS の設定（prefers-color-scheme）に合わせる */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export interface ViewerSettings {
  fontSize: FontSize;
  lineHeight: LineHeight;
  theme: Theme;
  /**
   * トリアージの実行画面で、修飾キーなしの数字キー（選ぶ）と Space（タイマー）を受けるか。
   * 文字のキーだけのショートカットは、音声入力や押し間違いで意図せず進むことがあるので切れるようにする（WCAG 2.1.4）。
   * 小窓でも同じ値を使うので、小窓と同期しているこのキーに置く
   */
  triageKeys: boolean;
}

// ゲームの横で目を離しながら読むので、既定でも一般的な本文（16px）より大きくする
export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  fontSize: "m",
  lineHeight: "relaxed",
  theme: "system",
  triageKeys: true,
};

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
export const THEME_LABEL: Record<Theme, string> = {
  light: "ライト",
  dark: "ダーク",
  system: "システム",
};

export const VIEWER_SETTINGS_KEY = "viewer";

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
    theme: oneOf(THEMES, record["theme"]) ?? DEFAULT_VIEWER_SETTINGS.theme,
    triageKeys:
      typeof record["triageKeys"] === "boolean"
        ? record["triageKeys"]
        : DEFAULT_VIEWER_SETTINGS.triageKeys,
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
    settingsSet(VIEWER_SETTINGS_KEY, settings).then(
      () => {
        set({ storageError: null });
      },
      (error: unknown) => {
        set({ storageError: errorMessage(error) });
      },
    );
  },
}));

/**
 * 保存した設定を読み込む。起動時に 1 回呼ぶ。読めなければ既定値のまま表示を続ける（設定のために閲覧を止めない）。
 * force は、別のウィンドウで変えた値を拾うとき（小窓を出すたび）。この画面で変えた値も保存済みなので上書きしてよい
 */
export async function loadViewerSettings(force = false): Promise<void> {
  try {
    const settings = parseViewerSettings(await settingsGet(VIEWER_SETTINGS_KEY));
    if (force || !useViewerSettings.getState().changed) {
      useViewerSettings.setState({ settings });
    }
  } catch (error: unknown) {
    useViewerSettings.setState({ storageError: errorMessage(error) });
  }
}
