import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PendingUpdate } from "@/lib/tauri";

import { UpdateDialog } from "./UpdateDialog";
import { useUpdateStore } from "./update-store";

function fakeUpdate(install: PendingUpdate["install"] = () => Promise.resolve()): PendingUpdate {
  return {
    info: {
      version: "0.0.2",
      currentVersion: "0.0.1",
      date: "2026-09-30 12:00:00.0 +00:00:00",
      notes: "- クイック表の誤字を直した",
    },
    install,
    dismiss: () => Promise.resolve(),
  };
}

afterEach(() => {
  cleanup();
  clearMocks();
  useUpdateStore.setState(useUpdateStore.getInitialState());
});

describe("UpdateDialog", () => {
  it("新しい版・公開日（JST）・変更点を出し、「後で」で閉じる", () => {
    useUpdateStore.setState({
      status: { kind: "available", update: fakeUpdate(), installError: null },
      dialogOpen: true,
    });
    render(<UpdateDialog />);

    expect(screen.getByRole("heading", { name: "新しい版があります" })).toBeTruthy();
    expect(screen.getByText(/v0\.0\.1 → v0\.0\.2/)).toBeTruthy();
    expect(screen.getByText(/2026\/09\/30 21:00 JST/)).toBeTruthy();
    expect(screen.getByText("- クイック表の誤字を直した")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "後で" }));

    expect(useUpdateStore.getState().dialogOpen).toBe(false);
    expect(useUpdateStore.getState().status.kind).toBe("available");
  });

  it("「今すぐ更新」でインストールし、起動し直す", async () => {
    const restarted: string[] = [];
    mockIPC((cmd) => {
      restarted.push(cmd);
      return null;
    });
    let installed = false;
    useUpdateStore.setState({
      status: {
        kind: "available",
        update: fakeUpdate(() => {
          installed = true;
          return Promise.resolve();
        }),
        installError: null,
      },
      dialogOpen: true,
    });
    render(<UpdateDialog />);

    fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));

    await expect.poll(() => restarted).toEqual(["plugin:process|restart"]);
    expect(installed).toBe(true);
  });

  it("ダウンロード中は進み具合を出し、ボタンを押せなくする", () => {
    useUpdateStore.setState({
      status: {
        kind: "installing",
        update: fakeUpdate(),
        progress: { downloaded: 5 * 1024 * 1024, total: 10 * 1024 * 1024 },
      },
      dialogOpen: true,
    });
    render(<UpdateDialog />);

    expect(screen.getByText("5.0 / 10.0 MB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "今すぐ更新" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "後で" }).hasAttribute("disabled")).toBe(true);
  });

  it("失敗したときは理由を出す", () => {
    useUpdateStore.setState({
      status: { kind: "available", update: fakeUpdate(), installError: "署名が一致しません" },
      dialogOpen: true,
    });
    render(<UpdateDialog />);

    expect(screen.getByText(/署名が一致しません/)).toBeTruthy();
  });

  it("更新が無ければ何も出さない", () => {
    render(<UpdateDialog />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
