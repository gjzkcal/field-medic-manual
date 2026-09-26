// 小窓の表示設定（背景の不透明度）と、メインの×ボタンの動作。
// 前者は settings のキー `overlay`、後者はキー `window`（Rust の window/mod.rs が閉じるときに読む）に保存する。
import { create } from "zustand";

import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

/** 背景の不透明度（%）。下げすぎると本文の後ろのゲーム画面がうるさくなり読めないので、下限を設ける */
export const OPACITY_MIN = 40;
export const OPACITY_MAX = 100;

export interface OverlaySettings {
  opacity: number;
}

export interface WindowSettings {
  /** ×で閉じたときにトレイに格納する（false なら終了する） */
  closeToTray: boolean;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = { opacity: 90 };
export const DEFAULT_WINDOW_SETTINGS: WindowSettings = { closeToTray: true };

const OVERLAY_KEY = "overlay";
const WINDOW_KEY = "window";

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export function parseOverlaySettings(value: unknown): OverlaySettings {
  const opacity = recordOf(value)["opacity"];
  return {
    opacity:
      typeof opacity === "number" && Number.isFinite(opacity)
        ? Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(opacity)))
        : DEFAULT_OVERLAY_SETTINGS.opacity,
  };
}

export function parseWindowSettings(value: unknown): WindowSettings {
  const closeToTray = recordOf(value)["closeToTray"];
  return {
    closeToTray:
      typeof closeToTray === "boolean" ? closeToTray : DEFAULT_WINDOW_SETTINGS.closeToTray,
  };
}

interface OverlaySettingsState {
  overlay: OverlaySettings;
  window: WindowSettings;
  storageError: string | null;
  updateOverlay: (patch: Partial<OverlaySettings>) => void;
  updateWindow: (patch: Partial<WindowSettings>) => void;
}

export const useOverlaySettings = create<OverlaySettingsState>()((set, get) => {
  function save(key: string, value: unknown): void {
    settingsSet(key, value).then(
      () => {
        set({ storageError: null });
      },
      (error: unknown) => {
        set({ storageError: errorMessage(error) });
      },
    );
  }
  return {
    overlay: DEFAULT_OVERLAY_SETTINGS,
    window: DEFAULT_WINDOW_SETTINGS,
    storageError: null,
    updateOverlay: (patch) => {
      const overlay = parseOverlaySettings({ ...get().overlay, ...patch });
      set({ overlay });
      save(OVERLAY_KEY, overlay);
    },
    updateWindow: (patch) => {
      const window = parseWindowSettings({ ...get().window, ...patch });
      set({ window });
      save(WINDOW_KEY, window);
    },
  };
});

/** 起動時と、小窓を出すたびに読む（設定はメインの設定画面で変えるため）。読めなければ既定値のまま。 */
export async function loadOverlaySettings(): Promise<void> {
  try {
    const [overlay, window] = await Promise.all([
      settingsGet(OVERLAY_KEY),
      settingsGet(WINDOW_KEY),
    ]);
    useOverlaySettings.setState({
      overlay: parseOverlaySettings(overlay),
      window: parseWindowSettings(window),
    });
  } catch (error: unknown) {
    useOverlaySettings.setState({ storageError: errorMessage(error) });
  }
}
