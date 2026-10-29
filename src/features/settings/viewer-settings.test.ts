import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VIEWER_SETTINGS,
  loadViewerSettings,
  parseViewerSettings,
  useViewerSettings,
} from "@/features/settings/viewer-settings";

afterEach(() => {
  clearMocks();
  useViewerSettings.setState({
    settings: DEFAULT_VIEWER_SETTINGS,
    changed: false,
    storageError: null,
  });
});

describe("parseViewerSettings", () => {
  it("正しい値はそのまま読む", () => {
    expect(
      parseViewerSettings({
        fontSize: "xl",
        lineHeight: "loose",
        theme: "dark",
        triageKeys: false,
      }),
    ).toEqual({
      fontSize: "xl",
      lineHeight: "loose",
      theme: "dark",
      triageKeys: false,
    });
  });

  it("保存されていない・不正な項目だけ既定値に戻す", () => {
    expect(parseViewerSettings(null)).toEqual(DEFAULT_VIEWER_SETTINGS);
    expect(parseViewerSettings("xl")).toEqual(DEFAULT_VIEWER_SETTINGS);
    expect(parseViewerSettings({ fontSize: "xxl", lineHeight: "loose", theme: "light" })).toEqual({
      fontSize: DEFAULT_VIEWER_SETTINGS.fontSize,
      lineHeight: "loose",
      theme: "light",
      triageKeys: true,
    });
  });

  it("トリアージのキー操作が保存されていない（前の版で保存した値）・不正ならオン", () => {
    expect(DEFAULT_VIEWER_SETTINGS.triageKeys).toBe(true);
    expect(parseViewerSettings({ fontSize: "l" }).triageKeys).toBe(true);
    expect(parseViewerSettings({ triageKeys: "no" }).triageKeys).toBe(true);
  });

  it("テーマが保存されていない（前の版で保存した値）・不正ならシステム", () => {
    expect(DEFAULT_VIEWER_SETTINGS.theme).toBe("system");
    expect(parseViewerSettings({ fontSize: "l", lineHeight: "normal" }).theme).toBe("system");
    expect(parseViewerSettings({ fontSize: "l", lineHeight: "normal", theme: "sepia" }).theme).toBe(
      "system",
    );
  });
});

describe("useViewerSettings", () => {
  it("変更すると settings_set でキー viewer に保存する", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "settings_set") {
        saved.push(args);
      }
      return null;
    });

    useViewerSettings.getState().update({ fontSize: "l" });

    expect(useViewerSettings.getState().settings.fontSize).toBe("l");
    await expect
      .poll(() => saved)
      .toEqual([{ key: "viewer", value: { ...DEFAULT_VIEWER_SETTINGS, fontSize: "l" } }]);
  });

  it("起動時に保存した値を読み込む。先に変えられていたら上書きしない", async () => {
    mockIPC((cmd) => (cmd === "settings_get" ? { fontSize: "xl", lineHeight: "normal" } : null));

    await loadViewerSettings();
    expect(useViewerSettings.getState().settings).toEqual({
      fontSize: "xl",
      lineHeight: "normal",
      theme: "system",
      triageKeys: true,
    });

    useViewerSettings.setState({ settings: DEFAULT_VIEWER_SETTINGS, changed: true });
    await loadViewerSettings();
    expect(useViewerSettings.getState().settings).toEqual(DEFAULT_VIEWER_SETTINGS);
  });
});
