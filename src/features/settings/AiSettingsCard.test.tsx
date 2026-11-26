import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAiKey } from "@/features/chat/ai-key";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";
import { axeViolations } from "@/test/axe";

let commands: string[] = [];

beforeEach(() => {
  commands = [];
  useAiKey.setState({ status: null });
  mockIPC((cmd) => {
    commands.push(cmd);
    return cmd === "ai_key_status" ? "set" : null;
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("AiSettingsCard", () => {
  it("キーの削除は、確かめてから行う", async () => {
    render(<AiSettingsCard />);
    const remove = await screen.findByRole("button", { name: "キーを削除" });
    await waitFor(() => {
      expect(remove.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "API キーを削除しますか？" });
    expect(commands).not.toContain("ai_key_clear");
    expect(await axeViolations()).toStrictEqual([]);

    // キャンセルしたら消さない
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(commands).not.toContain("ai_key_clear");

    fireEvent.click(screen.getByRole("button", { name: "キーを削除" }));
    const again = await screen.findByRole("dialog", { name: "API キーを削除しますか？" });
    fireEvent.click(within(again).getByRole("button", { name: "削除する" }));
    await waitFor(() => {
      expect(commands).toContain("ai_key_clear");
    });
    expect(await screen.findByText("API キーを削除しました")).toBeTruthy();
  });

  it("キーが未登録なら、削除は押せない", async () => {
    mockIPC((cmd) => (cmd === "ai_key_status" ? "missing" : null));
    render(<AiSettingsCard />);
    await screen.findByText("（未登録）");
    expect(screen.getByRole("button", { name: "キーを削除" }).hasAttribute("disabled")).toBe(true);
  });
});
