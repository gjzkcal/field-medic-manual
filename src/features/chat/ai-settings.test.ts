import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AI_EFFORT_RECOMMENDED,
  DEFAULT_AI_SETTINGS,
  hasCustomEffort,
  loadAiSettings,
  parseAiSettings,
  useAiSettings,
} from "@/features/chat/ai-settings";

function arg(args: unknown, key: string): unknown {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? Object.fromEntries(Object.entries(args))[key]
    : undefined;
}

/** settings_set に渡った値を覚え、settings_get には stored を返す */
function mockSettings(stored: unknown): unknown[] {
  const saved: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "settings_set") {
      saved.push(arg(args, "value"));
      return null;
    }
    if (cmd === "settings_get") {
      return stored;
    }
    return null;
  });
  return saved;
}

beforeEach(() => {
  useAiSettings.setState({
    settings: DEFAULT_AI_SETTINGS,
    customEffort: false,
    storageError: null,
  });
});

afterEach(() => {
  clearMocks();
});

describe("parseAiSettings", () => {
  it("Effort が無ければモデルの推奨にし、旧形式の Effort は明示として読む", () => {
    expect(parseAiSettings({ model: "claude-haiku-5-5" })).toStrictEqual({
      model: "claude-haiku-5-5",
      effort: AI_EFFORT_RECOMMENDED["claude-haiku-5-5"],
    });
    expect(parseAiSettings({ model: "claude-haiku-5-5", effort: null })).toStrictEqual({
      model: "claude-haiku-5-5",
      effort: AI_EFFORT_RECOMMENDED["claude-haiku-5-5"],
    });
    expect(hasCustomEffort({ model: "claude-opus-5-5", effort: "max" })).toBe(true);
    expect(hasCustomEffort({ model: "claude-opus-5-5", effort: null })).toBe(false);
    expect(hasCustomEffort(null)).toBe(false);
  });
});

describe("useAiSettings.update", () => {
  it("Effort を選んでいなければ、モデルを変えると推奨に追従し、Effort は保存しない", async () => {
    const saved = mockSettings(null);
    useAiSettings.getState().update({ model: "claude-haiku-5-5" });
    await Promise.resolve();
    expect(useAiSettings.getState().settings).toStrictEqual({
      model: "claude-haiku-5-5",
      effort: AI_EFFORT_RECOMMENDED["claude-haiku-5-5"],
    });
    expect(useAiSettings.getState().customEffort).toBe(false);
    expect(saved).toStrictEqual([{ model: "claude-haiku-5-5", effort: null }]);
  });

  it("Effort を選んだら、モデルを変えても保たれ、保存される", async () => {
    const saved = mockSettings(null);
    const { update } = useAiSettings.getState();
    update({ effort: "max" });
    update({ model: "claude-opus-5-5" });
    await Promise.resolve();
    expect(useAiSettings.getState().settings).toStrictEqual({
      model: "claude-opus-5-5",
      effort: "max",
    });
    expect(useAiSettings.getState().customEffort).toBe(true);
    expect(saved.at(-1)).toStrictEqual({ model: "claude-opus-5-5", effort: "max" });
  });

  it("起動時に旧形式の保存値を読むと、Effort は明示扱いになる", async () => {
    mockSettings({ model: "claude-opus-5-5", effort: "high" });
    await loadAiSettings();
    expect(useAiSettings.getState().settings).toStrictEqual({
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(useAiSettings.getState().customEffort).toBe(true);
  });
});
