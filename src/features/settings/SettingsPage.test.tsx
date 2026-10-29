import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_MOD_SETTINGS, useModSettings } from "@/features/settings/mod-settings";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { DEFAULT_VIEWER_SETTINGS, useViewerSettings } from "@/features/settings/viewer-settings";

afterEach(() => {
  cleanup();
  clearMocks();
  useModSettings.setState({ settings: DEFAULT_MOD_SETTINGS, storageError: null });
  useViewerSettings.setState({
    settings: DEFAULT_VIEWER_SETTINGS,
    changed: false,
    storageError: null,
  });
});

describe("SettingsPage", () => {
  it("テーマ・文字サイズ・行間を変えると、見本に反映して保存する", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "settings_set") {
        saved.push(args);
        return null;
      }
      // 開発用のデバッグ画面が読む一覧は空にしておく
      return [];
    });
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "XL" }));
    fireEvent.click(screen.getByRole("button", { name: "最大" }));
    fireEvent.click(screen.getByRole("button", { name: "ダーク" }));

    const preview = screen.getByLabelText("表示の見本");
    expect(preview.style.fontSize).toBe("24px");
    expect(preview.style.lineHeight).toBe("2");
    await expect
      .poll(() => saved.at(-1))
      .toEqual({
        key: "viewer",
        value: { fontSize: "xl", lineHeight: "loose", theme: "dark", triageKeys: true },
      });
  });

  it("使っている MOD を切り替えると保存し、既定は Circulation と Breathing が入っている", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "settings_set") {
        saved.push(args);
        return null;
      }
      return [];
    });
    render(<SettingsPage />);

    const circulation = screen.getByRole("switch", { name: "Circulation" });
    expect(circulation.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Breathing" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("switch", { name: "Hitzones" }).getAttribute("aria-checked")).toBe(
      "false",
    );

    fireEvent.click(circulation);
    fireEvent.click(screen.getByRole("switch", { name: "Hitzones" }));

    await expect
      .poll(() => saved.at(-1))
      .toEqual({ key: "mods", value: { enabled: ["hitzones", "breathing"] } });
  });

  it("トリアージの数字キーと Space をスイッチでオフにでき、viewer に保存する", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "settings_set") {
        saved.push(args);
        return null;
      }
      return [];
    });
    render(<SettingsPage />);

    const keys = screen.getByRole("switch", { name: "数字キーと Space で操作する" });
    expect(keys.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(keys);
    await expect
      .poll(() => saved.at(-1))
      .toEqual({ key: "viewer", value: { ...DEFAULT_VIEWER_SETTINGS, triageKeys: false } });
  });

  it("ホットキーの欄は、記録を終えてもフォーカスを外さず、変えたことを読み上げる", async () => {
    const set: unknown[] = [];
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "hotkey_list":
          return [
            {
              action: "search",
              accelerator: "Ctrl+Shift+F",
              defaultAccelerator: "Ctrl+Shift+F",
              error: null,
            },
          ];
        case "hotkey_set":
          set.push(args);
          return null;
        default:
          return [];
      }
    });
    render(<SettingsPage />);

    const field = await screen.findByRole("textbox", { name: "小窓で検索" });
    // 記録する欄であることを、説明として読み上げる
    expect(field.getAttribute("aria-describedby")).not.toBeNull();
    field.focus();
    fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    fireEvent.keyDown(field, { key: "g", code: "KeyG", ctrlKey: true, altKey: true });
    expect(document.activeElement).toBe(field);
    await waitFor(() => {
      expect(set).toEqual([{ action: "search", accelerator: "Ctrl+Alt+G" }]);
    });
    await waitFor(() => {
      expect(screen.getByText("「小窓で検索」を Ctrl + Alt + G にしました")).toBeDefined();
    });
  });
});
