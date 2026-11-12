import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CasualtiesPage } from "@/features/casualties/CasualtiesPage";
import { useCasualties } from "@/features/casualties/casualty-store";
import { setClockPaused } from "@/features/casualties/clock";
import { DEFAULT_MOD_SETTINGS, useModSettings } from "@/features/settings/mod-settings";
import { DEFAULT_VIEWER_SETTINGS, useViewerSettings } from "@/features/settings/viewer-settings";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { CasualtyEntry } from "@/lib/bindings/CasualtyEntry";
import { axeViolations } from "@/test/axe";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const ENTRY_KINDS: ReadonlySet<unknown> = new Set([
  "drug",
  "saline",
  "tourniquet_on",
  "tourniquet_off",
  "note",
]);

function isCasualtyEntry(value: unknown): value is CasualtyEntry {
  return isRecord(value) && ENTRY_KINDS.has(value["kind"]);
}

/** Rust の代わりに手元で記録を持つ。時刻は Date.now なので、テストが進めた時計に合う */
function fakeBackend(): { casualties: Casualty[] } {
  const state = { casualties: [] as Casualty[] };
  let id = 0;
  const nextId = (): string => {
    id += 1;
    return `id-${String(id)}`;
  };
  mockIPC((command, payload) => {
    if (command === "casualty_list") {
      return state.casualties;
    }
    if (command !== "casualty_apply") {
      return null;
    }
    const op = isRecord(payload) ? payload["op"] : undefined;
    if (!isRecord(op)) {
      throw new Error("casualty_apply に op がありません");
    }
    if (op["op"] === "add_casualty") {
      state.casualties = [
        ...state.casualties,
        {
          id: nextId(),
          name: String(op["name"]),
          createdAtMs: Date.now(),
          inPain: true,
          records: [],
        },
      ];
    } else if (op["op"] === "set_pain") {
      state.casualties = state.casualties.map((c) =>
        c.id === op["casualtyId"] ? { ...c, inPain: op["inPain"] === true } : c,
      );
    } else if (op["op"] === "add_record") {
      const entry = op["entry"];
      if (!isCasualtyEntry(entry)) {
        throw new Error("add_record の entry が記録の形ではありません");
      }
      state.casualties = state.casualties.map((c) =>
        c.id === op["casualtyId"]
          ? {
              ...c,
              records: [...c.records, { id: nextId(), atMs: Date.now(), entry }],
            }
          : c,
      );
    } else if (op["op"] === "remove_record") {
      state.casualties = state.casualties.map((c) => ({
        ...c,
        records: c.records.filter((r) => r.id !== op["recordId"]),
      }));
    } else if (op["op"] === "remove_casualty") {
      state.casualties = state.casualties.filter((c) => c.id !== op["casualtyId"]);
    } else if (op["op"] === "clear_all") {
      state.casualties = [];
    }
    return state.casualties;
  });
  return state;
}

async function addCasualty(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "足す" }));
  await screen.findByRole("heading", { name: "負傷者 1" });
}

function press(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  fakeBackend();
  useCasualties.setState({ casualties: [], loaded: false, error: null });
  useModSettings.setState({ settings: DEFAULT_MOD_SETTINGS });
  useViewerSettings.setState({ settings: DEFAULT_VIEWER_SETTINGS, changed: false });
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.useRealTimers();
});

describe("CasualtiesPage", () => {
  it("名前を入れなければ負傷者 1 で足す", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    expect(screen.getByRole("tab", { name: "負傷者 1" })).toBeDefined();
  });

  it("薬を記録するとカードにタイマーが出て、取り消すと閉じる", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    press("エピネフリン");
    const card = await screen.findByRole("heading", { level: 3, name: "エピネフリン" });
    expect(card).toBeDefined();
    expect(screen.getByText("ピークまで")).toBeDefined();
    expect(screen.getByText("消えるまで")).toBeDefined();
    expect(screen.getByText("1 本")).toBeDefined();

    press("直前の記録を取り消す");
    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 3, name: "エピネフリン" })).toBeNull();
    });
  });

  it("画面に読み上げの問題がない", { timeout: 30_000 }, async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    press("エピネフリン");
    press("生理食塩水");
    await screen.findByRole("heading", { level: 3, name: "生理食塩水" });
    fireEvent.click(screen.getByRole("button", { name: "左腕の止血帯" }));
    await screen.findByRole("heading", { level: 3, name: "止血帯（左腕）" });
    expect(await axeViolations()).toStrictEqual([]);
  });

  it("タイマーは残り時間を読み上げ続けない", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    press("エピネフリン");
    await screen.findByText("ピークまで");
    for (const timer of screen.getAllByRole("timer")) {
      expect(timer.getAttribute("aria-live")).toBe("off");
    }
  });

  it("止血帯は巻いてからの時間を出し、外すとカードが閉じる", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    const toggle = screen.getByRole("button", { name: "右脚の止血帯" });
    fireEvent.click(toggle);
    await screen.findByText("巻いてから");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.queryByText("巻いてから")).toBeNull();
    });
  });

  it("裏に回って時計が飛んでも、記録の時刻から正しい残りを出す", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    press("生理食塩水");
    await screen.findByText("入れ終わるまで");
    vi.setSystemTime(Date.now() + 60_000);
    setClockPaused(true);
    setClockPaused(false);
    await screen.findByText("30 s");
    vi.setSystemTime(Date.now() + 31_000);
    setClockPaused(true);
    setClockPaused(false);
    await waitFor(() => {
      expect(screen.queryByText("入れ終わるまで")).toBeNull();
    });
  });

  it("自動更新を止めると残り時間が動かず、再開すると今の値に戻る", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    press("生理食塩水");
    await screen.findByText("入れ終わるまで");
    const pause = screen.getByRole("switch", { name: "残り時間の自動更新を止める" });
    fireEvent.click(pause);
    const shown = screen.getByText("入れ終わるまで").parentElement?.textContent;
    vi.setSystemTime(Date.now() + 40_000);
    await Promise.resolve();
    expect(screen.getByText("入れ終わるまで").parentElement?.textContent).toBe(shown);
    fireEvent.click(pause);
    await screen.findByText("50 s");
  });

  it("Circulation がなければ、効能を出さず、次を打てるまでのタイマーだけを出す", async () => {
    useModSettings.setState({ settings: { enabled: [] } });
    render(<CasualtiesPage />);
    await addCasualty();
    expect(screen.queryByRole("button", { name: "メトプロロール" })).toBeNull();
    expect(screen.queryByRole("button", { name: "炭酸アンモニウム" })).toBeNull();
    press("モルヒネ");
    const heading = await screen.findByRole("heading", { level: 3, name: "モルヒネ" });
    const card = heading.closest("[data-slot=card]");
    if (!(card instanceof HTMLElement)) {
      throw new TypeError("薬のカードが見つかりません");
    }
    expect(within(card).getByText("次を打てるまで")).toBeDefined();
    expect(within(card).queryByText("消えるまで")).toBeNull();
    expect(within(card).queryByRole("progressbar")).toBeNull();
    press("エピネフリン");
    await screen.findByRole("heading", { level: 3, name: "エピネフリン" });
    expect(screen.getByText("30 s")).toBeDefined();
  });

  it("薬のカードに何本まで打てるかを出し、トグルで本数が変わる", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    // 既定は痛み・気胸ありで、激痛のフェニレフリンは 1 本でも危ない
    expect(screen.getByText("フェニレフリンは 1 本でも危険です。")).toBeDefined();
    press("エピネフリン");
    await screen.findByText("2 本まで OK まで");
    fireEvent.click(screen.getByRole("switch", { name: "痛み・気胸あり" }));
    await screen.findByText("4 本まで OK まで");
    expect(screen.queryByText("フェニレフリンは 1 本でも危険です。")).toBeNull();
  });

  it("意識喪失と心停止を切り替えると、設定に保存して本数が変わる", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    fireEvent.click(screen.getByRole("switch", { name: "痛み・気胸あり" }));
    press("メトプロロール");
    await screen.findByText("2 本まで OK まで");
    fireEvent.click(screen.getByRole("button", { name: "心停止" }));
    await screen.findByText("3 本まで OK まで");
    expect(useViewerSettings.getState().settings.overdoseLine).toBe("arrest");
  });

  it("Circulation がなければ、何本まで打てるかの帯を出さない", async () => {
    useModSettings.setState({ settings: { enabled: [] } });
    render(<CasualtiesPage />);
    await addCasualty();
    expect(screen.queryByRole("switch", { name: "痛み・気胸あり" })).toBeNull();
  });

  it("全部消すは確かめてから消す", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    press("全部消す");
    const dialog = await screen.findByRole("dialog");
    expect(useCasualties.getState().casualties).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "全部消す" }));
    await screen.findByText("負傷者はいません");
  });

  it("記録は後からも見られ、1 件ずつ取り消せる", async () => {
    render(<CasualtiesPage />);
    await addCasualty();
    press("モルヒネ");
    fireEvent.change(screen.getByRole("textbox", { name: "メモ" }), {
      target: { value: "右胸" },
    });
    press("残す");
    fireEvent.click(await screen.findByRole("button", { name: /記録（2 件）/u }));
    const removal = await screen.findByRole("button", { name: /メモ: 右胸を取り消す/u });
    fireEvent.click(removal);
    expect(await screen.findByRole("button", { name: /記録（1 件）/u })).toBeDefined();
  });

  it("小窓では、足した後は操作を畳み、誰もいなくなると開く", async () => {
    render(<CasualtiesPage compact />);
    await addCasualty();

    const trigger = await screen.findByRole("button", { name: "前提と操作" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "足す" })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("button", { name: "モルヒネ" })).toBeTruthy();

    fireEvent.click(trigger);
    press("この負傷者を消す");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "消す" }));
    await screen.findByText("負傷者はいません");
    expect(screen.getByRole("button", { name: "足す" })).toBeTruthy();
  });

  it("小窓でも直前の記録を取り消せる", async () => {
    render(<CasualtiesPage compact />);
    await addCasualty();
    press("モルヒネ");
    await screen.findByRole("button", { name: /記録（1 件）/u });
    press("直前の記録を取り消す");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /記録（1 件）/u })).toBeNull();
    });
  });
});
