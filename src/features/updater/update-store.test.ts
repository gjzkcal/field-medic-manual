import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { checkForUpdates, installUpdate, postponeUpdate, useUpdateStore } from "./update-store";

const METADATA = {
  rid: 7,
  currentVersion: "0.0.1",
  version: "0.0.2",
  date: "2026-09-30 12:00:00.000 +00:00:00",
  body: "- 変更点",
  rawJson: {},
};

afterEach(() => {
  clearMocks();
  useUpdateStore.setState(useUpdateStore.getInitialState());
});

describe("checkForUpdates", () => {
  it("新しい版があれば、ダイアログを開いて版と変更点を持つ", async () => {
    mockIPC((cmd) => (cmd === "plugin:updater|check" ? METADATA : null));

    await checkForUpdates({ manual: false });

    const state = useUpdateStore.getState();
    expect(state.dialogOpen).toBe(true);
    expect(state.status.kind).toBe("available");
    if (state.status.kind === "available") {
      expect(state.status.update.info).toEqual({
        version: "0.0.2",
        currentVersion: "0.0.1",
        date: METADATA.date,
        notes: "- 変更点",
      });
    }
  });

  it("手動の確認で新しい版が無ければ「最新」にする", async () => {
    mockIPC(() => null);

    await checkForUpdates({ manual: true });

    expect(useUpdateStore.getState().status.kind).toBe("upToDate");
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
  });

  it("起動時の確認の失敗（オフラインなど）は画面に出さない", async () => {
    mockIPC(() => {
      throw new Error("error sending request");
    });

    await checkForUpdates({ manual: false });

    expect(useUpdateStore.getState().status.kind).toBe("idle");
  });

  it("手動の確認の失敗は理由を出す", async () => {
    mockIPC(() => {
      throw new Error("error sending request");
    });

    await checkForUpdates({ manual: true });

    const { status } = useUpdateStore.getState();
    expect(status).toEqual({ kind: "error", message: "error sending request" });
  });

  it("確認の途中でもう一度呼んでも、確認は 1 回だけ", async () => {
    let calls = 0;
    mockIPC((cmd) => {
      if (cmd === "plugin:updater|check") {
        calls += 1;
      }
      return null;
    });

    await Promise.all([checkForUpdates({ manual: true }), checkForUpdates({ manual: true })]);

    expect(calls).toBe(1);
  });
});

describe("postponeUpdate", () => {
  it("ダイアログを閉じても、更新があることは覚えておく（About から開き直せる）", async () => {
    mockIPC((cmd) => (cmd === "plugin:updater|check" ? METADATA : null));
    await checkForUpdates({ manual: false });

    postponeUpdate();

    expect(useUpdateStore.getState().dialogOpen).toBe(false);
    expect(useUpdateStore.getState().status.kind).toBe("available");
  });
});

describe("installUpdate", () => {
  it("ダウンロードしてインストールし、終わったら起動し直す", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd === "plugin:updater|check" ? METADATA : null;
    });
    await checkForUpdates({ manual: false });

    await installUpdate();

    expect(calls).toEqual([
      "plugin:updater|check",
      "plugin:updater|download_and_install",
      "plugin:process|restart",
    ]);
  });

  it("失敗したら理由を出し、もう一度押せるようにする", async () => {
    mockIPC((cmd) => {
      if (cmd === "plugin:updater|download_and_install") {
        throw new Error("signature verification failed");
      }
      return cmd === "plugin:updater|check" ? METADATA : null;
    });
    await checkForUpdates({ manual: false });

    await installUpdate();

    const { status } = useUpdateStore.getState();
    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.installError).toBe("signature verification failed");
    }
  });
});
