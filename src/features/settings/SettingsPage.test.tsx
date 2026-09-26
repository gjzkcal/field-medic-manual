import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsPage } from "@/features/settings/SettingsPage";
import { DEFAULT_VIEWER_SETTINGS, useViewerSettings } from "@/features/settings/viewer-settings";

afterEach(() => {
  cleanup();
  clearMocks();
  useViewerSettings.setState({
    settings: DEFAULT_VIEWER_SETTINGS,
    changed: false,
    storageError: null,
  });
});

describe("SettingsPage", () => {
  it("文字サイズと行間を変えると、見本に反映して保存する", async () => {
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

    const preview = screen.getByLabelText("表示の見本");
    expect(preview.style.fontSize).toBe("24px");
    expect(preview.style.lineHeight).toBe("2");
    await expect
      .poll(() => saved.at(-1))
      .toEqual({ key: "viewer", value: { fontSize: "xl", lineHeight: "loose" } });
  });
});
