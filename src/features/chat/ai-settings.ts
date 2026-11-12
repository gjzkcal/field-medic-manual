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

/**
 * モデルごとの推奨の Effort。利用者が Effort を選んでいなければ、これを使う。
 * 値は、同梱の評価セット（src-tauri/eval、20 問）で 3 モデルの答えの質がそろう最も安い段階にする。
 * 2026-11-13 の計測では、3 モデルとも medium だけが 20 問すべてを通り（low は 1〜2 問落ちる）、
 * high は medium より良くならずに出力だけが 1.5〜2 倍になった。
 */
export const AI_EFFORT_RECOMMENDED: Record<AiModel, AiEffort> = {
  "claude-opus-5-5": "medium",
  "claude-sonnet-5-5": "medium",
  "claude-haiku-5-5": "medium",
};

export const AI_MODELS = Object.keys(AI_MODEL_LABELS).filter((key) => isAiModel(key));
export const AI_EFFORTS = Object.keys(AI_EFFORT_LABELS).filter((key) => isAiEffort(key));

const DEFAULT_MODEL: AiModel = "claude-sonnet-5-5";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: DEFAULT_MODEL,
  effort: AI_EFFORT_RECOMMENDED[DEFAULT_MODEL],
};

const AI_KEY = "ai";

export function isAiModel(value: unknown): value is AiModel {
  return typeof value === "string" && Object.hasOwn(AI_MODEL_LABELS, value);
}

export function isAiEffort(value: unknown): value is AiEffort {
  return typeof value === "string" && Object.hasOwn(AI_EFFORT_LABELS, value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** 保存した値を読む。Effort が無い・無効なら、そのモデルの推奨にする。 */
export function parseAiSettings(value: unknown): AiSettings {
  const record = asRecord(value);
  const model = isAiModel(record["model"]) ? record["model"] : DEFAULT_MODEL;
  const effort = record["effort"];
  return {
    model,
    effort: isAiEffort(effort) ? effort : AI_EFFORT_RECOMMENDED[model],
  };
}

/** 利用者が Effort を自分で選んでいるか（選んでいなければ、モデルを変えたときに推奨へ追従する）。 */
export function hasCustomEffort(value: unknown): boolean {
  return isAiEffort(asRecord(value)["effort"]);
}

interface AiSettingsState {
  settings: AiSettings;
  /** 利用者が Effort を選んでいる（null なら推奨に追従する） */
  customEffort: boolean;
  storageError: string | null;
  update: (patch: Partial<AiSettings>) => void;
}

export const useAiSettings = create<AiSettingsState>()((set, get) => ({
  settings: DEFAULT_AI_SETTINGS,
  customEffort: false,
  storageError: null,
  update: (patch) => {
    const customEffort = get().customEffort || patch.effort !== undefined;
    const model = patch.model ?? get().settings.model;
    const settings = parseAiSettings({
      model,
      effort: patch.effort ?? (customEffort ? get().settings.effort : AI_EFFORT_RECOMMENDED[model]),
    });
    set({ settings, customEffort });
    // 推奨に追従しているときは effort を保存しない。推奨の値を後で変えたときに、その人にも新しい推奨が効くようにするため
    settingsSet(AI_KEY, {
      model: settings.model,
      effort: customEffort ? settings.effort : null,
    }).then(
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
    const stored = await settingsGet(AI_KEY);
    useAiSettings.setState({
      settings: parseAiSettings(stored),
      customEffort: hasCustomEffort(stored),
    });
  } catch (error: unknown) {
    useAiSettings.setState({ storageError: errorMessage(error) });
  }
}
