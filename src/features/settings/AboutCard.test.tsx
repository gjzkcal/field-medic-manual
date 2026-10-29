import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AboutCard } from "@/features/settings/AboutCard";
import { useUpdateStore } from "@/features/updater/update-store";

afterEach(() => {
  cleanup();
  clearMocks();
  useUpdateStore.setState(useUpdateStore.getInitialState());
});

describe("AboutCard", () => {
  it("版・ライセンス・原稿の出典・Bohemia の免責文を出す", async () => {
    mockIPC((cmd) => (cmd === "app_version" ? "0.0.1" : null));
    render(<AboutCard />);

    expect(await screen.findByText("v0.0.1")).toBeTruthy();
    expect(screen.getByText(/GPL-3\.0-or-later/)).toBeTruthy();
    expect(screen.getByText(/acemod\/ACE-Anvil、GPL-2\.0-or-later/)).toBeTruthy();
    expect(
      screen.getByText(/not affiliated with or authorized by Bohemia Interactive/),
    ).toBeTruthy();
  });

  // 設定画面の h1 の下で、カードの表題を h2、その中の節を h3 にする。段が飛ぶと、
  // スクリーンリーダーで階層を追えない（Lighthouse の heading-order）
  it("カードの表題を h2、節の見出しを h3 にする", async () => {
    mockIPC((cmd) => (cmd === "app_version" ? "0.0.1" : null));
    render(<AboutCard />);

    expect(await screen.findByText("v0.0.1")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "このアプリについて",
    ]);
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("heading", { level: 4 })).toEqual([]);
  });

  it("「更新を確認」で最新なら、その旨を出す", async () => {
    mockIPC((cmd) => (cmd === "app_version" ? "0.0.1" : null));
    render(<AboutCard />);

    fireEvent.click(screen.getByRole("button", { name: "更新を確認" }));

    expect(await screen.findByText("最新の版です")).toBeTruthy();
  });

  it("「更新を確認」で新しい版があれば、ダイアログを開き直せる", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "app_version":
          return "0.0.1";
        case "plugin:updater|check":
          return { rid: 1, currentVersion: "0.0.1", version: "0.0.2", rawJson: {} };
        default:
          return null;
      }
    });
    render(<AboutCard />);

    fireEvent.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("新しい版 v0.0.2 があります")).toBeTruthy();
    useUpdateStore.setState({ dialogOpen: false });

    fireEvent.click(screen.getByRole("button", { name: "更新の内容を見る" }));

    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("サードパーティのライセンスは開いたときに読み込む", async () => {
    mockIPC((cmd) => (cmd === "app_version" ? "0.0.1" : null));
    render(<AboutCard />);

    expect(screen.queryByLabelText("サードパーティのライセンスの全文")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "サードパーティのライセンス" }));

    const text = await screen.findByLabelText("サードパーティのライセンスの全文");
    expect(text.textContent).toContain("Third-party licenses");
    expect(text.textContent).toContain("Used by: react ");
  });
});
