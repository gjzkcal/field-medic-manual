// AI チャットのモデルと Effort。settings のキー `ai` に保存する。
// 会話の途中で変えても、その会話には効かない（Rust が会話の最初の値に固定する。thinking の署名が結び付くため）。
import { create } from "zustand";

import type { AiEffort } from "@/lib/bindings/AiEffort";
import type { AiModel } from "@/lib/bindings/AiModel";
import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

export interface AiSettings {
  model: AiModel;
  effort: AiEffort;
}

// Record にしておくと、Rust 側でモデルを足したときに選択肢の漏れがコンパイルエラーになる
export const AI_MODEL_LABELS: Record<AiModel, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
};

/** 費用の目安（2026-10-06 時点の単価。入力 / 出力、100 万トークンあたり）。価格は変わるので Anthropic の料金表を正とする */
export const AI_MODEL_DESCRIPTIONS: Record<AiModel, string> = {
  "claude-opus-5-5": "いちばん賢い。費用も高い（$4 / $20）",
  "claude-sonnet-5-5": "賢さと費用の釣り合いがよい（$2 / $10）",
  "claude-haiku-5-5": "速くて安い。込み入った質問は苦手（$0.10 / $0.50）",
};

export const AI_EFFORT_LABELS: Record<AiEffort, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "とても高い",
  max: "最大限",
};

export const AI_MODELS = Object.keys(AI_MODEL_LABELS).filter(isAiModel);
export const AI_EFFORTS = Object.keys(AI_EFFORT_LABELS).filter(isAiEffort);

export const DEFAULT_AI_SETTINGS: AiSettings = { model: "claude-sonnet-5-5", effort: "medium" };

const AI_KEY = "ai";

export function isAiModel(value: unknown): value is AiModel {
  return typeof value === "string" && Object.hasOwn(AI_MODEL_LABELS, value);
}

export function isAiEffort(value: unknown): value is AiEffort {
  return typeof value === "string" && Object.hasOwn(AI_EFFORT_LABELS, value);
}

export function parseAiSettings(value: unknown): AiSettings {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const model = record["model"];
  const effort = record["effort"];
  return {
    model: isAiModel(model) ? model : DEFAULT_AI_SETTINGS.model,
    effort: isAiEffort(effort) ? effort : DEFAULT_AI_SETTINGS.effort,
  };
}

interface AiSettingsState {
  settings: AiSettings;
  storageError: string | null;
  update: (patch: Partial<AiSettings>) => void;
}

export const useAiSettings = create<AiSettingsState>()((set, get) => ({
  settings: DEFAULT_AI_SETTINGS,
  storageError: null,
  update: (patch) => {
    const settings = parseAiSettings({ ...get().settings, ...patch });
    set({ settings });
    settingsSet(AI_KEY, settings).then(
      () => {
        set({ storageError: null });
      },
      (error: unknown) => {
        set({ storageError: errorMessage(error) });
      },
    );
  },
}));

/** 起動時に読む。読めなければ既定値のまま。 */
export async function loadAiSettings(): Promise<void> {
  try {
    useAiSettings.setState({ settings: parseAiSettings(await settingsGet(AI_KEY)) });
  } catch (error: unknown) {
    useAiSettings.setState({ storageError: errorMessage(error) });
  }
}
