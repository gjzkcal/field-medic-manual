import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WindowControls } from "@/app/WindowControls";

let calls: string[] = [];
let maximized = false;

beforeEach(() => {
  calls = [];
  maximized = false;
  mockWindows("main");
  mockIPC(
    (cmd) => {
      calls.push(cmd);
      return cmd === "plugin:window|is_maximized" ? maximized : undefined;
    },
    { shouldMockEvents: true },
  );
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("WindowControls", () => {
  it.each([
    ["最小化", "plugin:window|minimize"],
    ["最大化", "plugin:window|toggle_maximize"],
    ["閉じる", "plugin:window|close"],
  ])("「%s」ボタンで %s を呼ぶ", async (label, command) => {
    render(<WindowControls />);

    fireEvent.click(await screen.findByRole("button", { name: label }));

    expect(calls).toContain(command);
  });

  it("最大化中は「元に戻す」ボタンを表示する", async () => {
    maximized = true;

    render(<WindowControls />);

    expect(await screen.findByRole("button", { name: "元に戻す" })).toBeDefined();
  });
});
