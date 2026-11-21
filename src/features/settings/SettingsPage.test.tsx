import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MOD_SETTINGS, useModSettings } from "@/features/settings/mod-settings";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { DEFAULT_VIEWER_SETTINGS, useViewerSettings } from "@/features/settings/viewer-settings";
import { axeViolations } from "@/test/axe";

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

/** 設定画面はアドレスの `#…` を読むので、ルーターの中で描く。 */
function renderPage(entry = "/settings"): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

function headings(level: number): (string | null)[] {
  return screen.queryAllByRole("heading", { level }).map((h) => h.textContent);
}

describe("SettingsPage", () => {
  // 並びは「見た目 → 入力 → ウィンドウ → 機能ごと → データ → アプリの情報」。同じ種類の設定を別のカードに散らさない
  it("カードを決まった順に並べ、表題を h2、節の見出しを h3 にする", async () => {
    mockIPC((cmd) => (cmd === "app_version" ? "0.0.1" : []));
    renderPage();
    await screen.findByText("v0.0.1");

    expect(headings(2)).toStrictEqual([
      "表示",
      "使っている MOD",
      "キー操作",
      "ウィンドウと小窓",
      "負傷者",
      "AI チャット",
      "データ",
      "このアプリについて",
      // 開発ビルドだけの欄（配布版には出ない）
      "デバッグ（開発ビルドのみ）",
    ]);
    expect(headings(3)).toStrictEqual(
      expect.arrayContaining([
        "ホットキー",
        "トリアージ",
        "メインのウィンドウ",
        "小窓",
        "バックアップ",
        "保存場所",
      ]),
    );
    expect(headings(4)).toStrictEqual([]);
  });

  it("「保存場所を開く」で data_folder_open を引数なしで呼ぶ", async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "data_folder_open") {
        calls.push(args);
        return null;
      }
      return [];
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "保存場所を開く" }));
    await waitFor(() => {
      // 開く場所は Rust が決める。画面からパスを渡さない
      expect(calls).toStrictEqual([{}]);
    });
    expect(screen.queryByText(/保存場所を開けませんでした/u)).toBeNull();
  });

  it("保存場所を開けなかったら、理由を知らせる", async () => {
    mockIPC((cmd) => {
      if (cmd === "data_folder_open") {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Tauri はコマンドのエラーを Error ではなく AppError の素のオブジェクトで reject する。それを再現する
        return Promise.reject({ kind: "internal", message: "フォルダがありません" });
      }
      return [];
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "保存場所を開く" }));
    const alert = await screen.findByText(/保存場所を開けませんでした/u);
    expect(alert.textContent).toContain("フォルダがありません");
    expect(alert.getAttribute("role")).toBe("alert");
  });

  // AI チャットの「設定を開く」は /settings#ai で来る。カードが下のほうにあるので、移らないと見つけにくい
  it("アドレスの #ai で、AI チャットのカードへ移ってフォーカスを置く", async () => {
    const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockIPC(() => []);
    renderPage("/settings#ai");

    const title = screen.getByRole("heading", { level: 2, name: "AI チャット" });
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(title.closest("#ai"));
  });

  // 設定を開いたまま別のカードを見ていて、チャットの「設定を開く」をもう一度押したとき。アドレスは変わらない
  it("同じ #ai へもう一度移っても、AI チャットのカードへ移ってフォーカスを置く", async () => {
    const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockIPC(() => []);
    const router = createMemoryRouter([{ path: "/settings", element: <SettingsPage /> }], {
      initialEntries: ["/settings#ai"],
    });
    render(<RouterProvider router={router} />);

    const title = await screen.findByRole("heading", { level: 2, name: "AI チャット" });
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });
    screen.getByRole("button", { name: "保存場所を開く" }).focus();

    await router.navigate("/settings#ai");
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });
    expect(document.activeElement).toBe(title);
  });

  it("アドレスに # が無いとき、または設定のカードを指していないときは、移らない", () => {
    const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockIPC(() => []);
    renderPage("/settings#no-such-card");

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

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
    renderPage();

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
        value: {
          ...DEFAULT_VIEWER_SETTINGS,
          fontSize: "xl",
          lineHeight: "loose",
          theme: "dark",
        },
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
    renderPage();

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
    renderPage();

    const keys = screen.getByRole("switch", { name: "数字キーと Space で操作する" });
    expect(keys.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(keys);
    await expect
      .poll(() => saved.at(-1))
      .toEqual({ key: "viewer", value: { ...DEFAULT_VIEWER_SETTINGS, triageKeys: false } });
  });

  it("負傷者の危ない線を心停止に変え、viewer に保存する", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "settings_set") {
        saved.push(args);
        return null;
      }
      return [];
    });
    renderPage();

    const group = screen.getByRole("group", { name: "危ない線" });
    expect(group).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "心停止" }));
    await expect
      .poll(() => saved.at(-1))
      .toEqual({ key: "viewer", value: { ...DEFAULT_VIEWER_SETTINGS, overdoseLine: "arrest" } });
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
    renderPage();

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
      expect(set).toStrictEqual([{ action: "search", accelerator: "Ctrl+Alt+G" }]);
    });
    await waitFor(() => {
      expect(screen.getByText("「小窓で検索」を Ctrl + Alt + G にしました")).toBeDefined();
    });
  });

  it("ホットキーのエラーを含めて、axe の違反がない（WCAG 2.2 A・AA）", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "hotkey_list":
          return [
            {
              action: "toggle",
              accelerator: "Ctrl+Shift+M",
              defaultAccelerator: "Ctrl+Shift+M",
              error: "ほかのアプリが使っています",
            },
          ];
        case "app_version":
          return "0.0.1";
        default:
          // 開発ビルドだけのデバッグの欄が一覧を読むので、空の一覧を返す
          return [];
      }
    });
    renderPage();
    await screen.findByText("ほかのアプリが使っています");
    await screen.findByText("v0.0.1");
    expect(await axeViolations()).toStrictEqual([]);
  });
});
