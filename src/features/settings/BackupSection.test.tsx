import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useContentSync } from "@/features/content/sync";
import { BackupSection } from "@/features/settings/BackupSection";
import { emptySyncResult } from "@/features/sync/result";
import type { BackupEntry } from "@/lib/bindings/BackupEntry";
import type { BackupPreview } from "@/lib/bindings/BackupPreview";
import { axeViolations } from "@/test/axe";

const ENTRIES: BackupEntry[] = [
  {
    id: "before-restore-20261121T030000Z.json",
    kind: "before_restore",
    createdAt: "2026-11-21T03:00:00Z",
    sizeBytes: 900,
  },
  {
    id: "auto-20261120T030000Z.json",
    kind: "auto",
    createdAt: "2026-11-20T03:00:00Z",
    sizeBytes: 800,
  },
];

const PREVIEW: BackupPreview = {
  token: "token-1",
  kind: "auto",
  createdAt: "2026-11-20T03:00:00Z",
  appVersion: "0.9.0",
  favorites: 12,
  history: 34,
  settings: ["viewer", "hotkeys"],
  unresolvedFavorites: 0,
  unresolvedHistory: 0,
  skippedSettings: [],
};

/**
 * コマンドごとの応答を決め、呼ばれたコマンドと引数を集める。
 * @param lazy 呼ばれたときに作る応答（失敗や、返ってこない応答）
 */
function mock(
  replies: Record<string, unknown>,
  lazy: Record<string, () => unknown> = {},
): [string, unknown][] {
  const calls: [string, unknown][] = [];
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    return lazy[cmd]?.() ?? replies[cmd] ?? null;
  });
  return calls;
}

/** 応答が返ってこないコマンド（復元が通ると、応答の前にアプリが再起動する）。 */
function never(): Promise<never> {
  return new Promise<never>(() => {
    // 何も返さない
  });
}

function called(calls: [string, unknown][], cmd: string): unknown[] {
  return calls.filter(([name]) => name === cmd).map(([, args]) => args);
}

beforeEach(() => {
  // 原稿の同期が終わっている状態（起動して少したった後）を、ふだんの前提にする
  useContentSync.setState({
    state: { status: "done", result: emptySyncResult() },
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
  useContentSync.setState({ state: { status: "idle" } });
});

describe("BackupSection", () => {
  it("アプリが取ったバックアップを、種類と日時（JST）で新しい順に出す", async () => {
    mock({ backup_list: ENTRIES });
    render(<BackupSection />);

    const list = await screen.findByRole("list", { name: "アプリが取ったバックアップ" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toStrictEqual([
      "復元の前 2026/11/21 12:00 JSTこの時点に戻す",
      "自動 2026/11/20 12:00 JSTこの時点に戻す",
    ]);
  });

  it("まだ 1 つも無いときは、その旨を出す", async () => {
    mock({ backup_list: [] });
    render(<BackupSection />);

    expect(await screen.findByText(/自動のバックアップは、まだありません/u)).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("書き出すと、書いたファイルの名前と件数を知らせる。保存先は画面から渡さない", async () => {
    const calls = mock({
      backup_list: [],
      backup_export: { fileName: "my-backup.json", favorites: 3, history: 5, skipped: 0 },
    });
    render(<BackupSection />);

    fireEvent.click(screen.getByRole("button", { name: "ファイルに書き出す" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "my-backup.json に書き出しました（お気に入り 3 件・履歴 5 件）",
    );
    expect(called(calls, "backup_export")).toStrictEqual([{}]);
  });

  it("書き出せなかった項目があれば、件数を知らせる", async () => {
    mock({
      backup_list: [],
      backup_export: { fileName: "b.json", favorites: 1, history: 0, skipped: 2 },
    });
    render(<BackupSection />);

    fireEvent.click(screen.getByRole("button", { name: "ファイルに書き出す" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "マニュアルから無くなった項目など 2 件は入れていません",
    );
  });

  it("保存先のダイアログを取り消したら、何も知らせない", async () => {
    const calls = mock({ backup_list: [], backup_export: null });
    render(<BackupSection />);

    const button = screen.getByRole("button", { name: "ファイルに書き出す" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(called(calls, "backup_export")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(button).toHaveProperty("disabled", false);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("自動のバックアップを選ぶと、戻す内容を確かめてから、合い言葉を渡して復元する", async () => {
    const calls = mock(
      { backup_list: ENTRIES, backup_open_auto: PREVIEW },
      { backup_restore: never },
    );
    render(<BackupSection />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "この時点に戻す: 自動 2026/11/20 12:00 JST",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "バックアップから復元" });
    expect(called(calls, "backup_open_auto")).toStrictEqual([{ id: "auto-20261120T030000Z.json" }]);
    expect(dialog.textContent).toContain("2026/11/20 12:00 JST（自動、v0.9.0）");
    expect(dialog.textContent).toContain("お気に入り 12 件・履歴 34 件・設定 2 項目");
    expect(dialog.textContent).toContain("今の状態は「復元の前」として自動でバックアップしてから");
    expect(dialog.textContent).not.toContain("戻せないもの");
    // 確かめるまでは、何も置き換えない
    expect(called(calls, "backup_restore")).toStrictEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "置き換えて再起動" }));
    await waitFor(() => {
      expect(called(calls, "backup_restore")).toStrictEqual([{ token: "token-1" }]);
    });
    expect((await within(dialog).findByRole("status")).textContent).toContain("再起動します");
    // 再起動を待つ間に、もう一度押したり閉じたりできない
    expect(within(dialog).getByRole("button", { name: "置き換えて再起動" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByRole("button", { name: "キャンセル" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("戻せない項目と、この版に無い設定があれば、確認に出す", async () => {
    mock({
      backup_list: [],
      backup_open_file: {
        ...PREVIEW,
        kind: "manual",
        unresolvedFavorites: 2,
        unresolvedHistory: 1,
        skippedSettings: ["future"],
      },
    });
    render(<BackupSection />);

    fireEvent.click(screen.getByRole("button", { name: "ファイルから復元" }));
    const dialog = await screen.findByRole("dialog", { name: "バックアップから復元" });
    expect(dialog.textContent).toContain("今のマニュアルに見つからないお気に入り 2 件・履歴 1 件");
    expect(dialog.textContent).toContain("この版のアプリに無い設定 1 項目");
  });

  it("キャンセルしたら、復元しない", async () => {
    const calls = mock({ backup_list: [], backup_open_file: PREVIEW });
    render(<BackupSection />);

    fireEvent.click(screen.getByRole("button", { name: "ファイルから復元" }));
    const dialog = await screen.findByRole("dialog", { name: "バックアップから復元" });
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(called(calls, "backup_restore")).toStrictEqual([]);
  });

  it("ファイルを選ぶダイアログを取り消したら、確認を出さない", async () => {
    const calls = mock({ backup_list: [], backup_open_file: null });
    render(<BackupSection />);

    fireEvent.click(screen.getByRole("button", { name: "ファイルから復元" }));
    await waitFor(() => {
      expect(called(calls, "backup_open_file")).toHaveLength(1);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("バックアップでないファイルを選んだら、理由を知らせる", async () => {
    mock(
      { backup_list: [] },
      {
        backup_open_file: () =>
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Tauri はコマンドのエラーを Error ではなく AppError の素のオブジェクトで reject する。それを再現する
          Promise.reject({
            kind: "invalid_input",
            message: "入力が不正です: このアプリのバックアップのファイルではありません",
          }),
      },
    );
    render(<BackupSection />);

    fireEvent.click(screen.getByRole("button", { name: "ファイルから復元" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "バックアップを読めませんでした: 入力が不正です: このアプリのバックアップのファイルではありません",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("復元に失敗したら、確認を閉じて理由を知らせ、もう一度選べるようにする", async () => {
    mock(
      { backup_list: ENTRIES, backup_open_auto: PREVIEW },
      {
        backup_restore: () =>
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Tauri はコマンドのエラーを Error ではなく AppError の素のオブジェクトで reject する。それを再現する
          Promise.reject({ kind: "io", message: "ファイルを読み書きできませんでした" }),
      },
    );
    render(<BackupSection />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "この時点に戻す: 自動 2026/11/20 12:00 JST",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "バックアップから復元" });
    fireEvent.click(within(dialog).getByRole("button", { name: "置き換えて再起動" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("復元できませんでした: ファイルを読み書きできませんでした");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "ファイルから復元" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  // 原稿を DB に入れ終わる前に復元すると、お気に入りと履歴の行き先が見つからず、戻せない
  it.each(["idle", "syncing"] as const)(
    "マニュアルの準備中（%s）は、復元を押せない。書き出しはできる",
    async (status) => {
      useContentSync.setState({ state: { status } });
      mock({ backup_list: ENTRIES });
      render(<BackupSection />);

      expect(screen.getByRole("button", { name: "ファイルから復元" })).toHaveProperty(
        "disabled",
        true,
      );
      const pick = await screen.findByRole("button", {
        name: "この時点に戻す: 自動 2026/11/20 12:00 JST",
      });
      expect(pick).toHaveProperty("disabled", true);
      expect(screen.getByText("マニュアルの準備が終わるまで、復元はできません。")).toBeDefined();
      expect(screen.getByRole("button", { name: "ファイルに書き出す" })).toHaveProperty(
        "disabled",
        false,
      );
    },
  );

  it("一覧と確認のダイアログに、axe の違反がない（WCAG 2.2 A・AA）", async () => {
    mock({
      backup_list: ENTRIES,
      backup_open_auto: { ...PREVIEW, unresolvedFavorites: 1, skippedSettings: ["future"] },
    });
    render(<BackupSection />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "この時点に戻す: 自動 2026/11/20 12:00 JST",
      }),
    );
    await screen.findByRole("dialog", { name: "バックアップから復元" });
    expect(await axeViolations()).toStrictEqual([]);
  });
});
