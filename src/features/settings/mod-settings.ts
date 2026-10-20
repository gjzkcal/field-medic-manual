// 使っている MOD（ACE Medical のモジュールと、ACE 以外の MOD）。トリアージのフローは、これを見て branch ノードで
// 自動に分岐する。settings のキー `mods` に `{ enabled, known }` で保存する。
import { create } from "zustand";

import { MOD_TARGET_LABELS } from "@/features/content/meta";
import { ALWAYS_ACTIVE_MODS, type ActiveMods } from "@/features/triage/runner";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import { errorMessage, settingsGet, settingsSet } from "@/lib/tauri";

/** 設定で切り替える ACE Medical のモジュール（表示と保存の順）。Core は常にあり、Defibrillation は未公開なので出さない */
export const ACE_SELECTABLE_MODS = [
  "hitzones",
  "circulation",
  "breathing",
  "ai",
] as const satisfies readonly ModTarget[];
/** 設定で切り替える ACE 以外の MOD。RHS は防具の仕組みが本体と違う（WCS のサーバーも RHS を入れる） */
export const OTHER_SELECTABLE_MODS = ["rhs"] as const satisfies readonly ModTarget[];
export const SELECTABLE_MODS = [...ACE_SELECTABLE_MODS, ...OTHER_SELECTABLE_MODS] as const;
export type SelectableMod = (typeof SELECTABLE_MODS)[number];

export interface ModSettings {
  enabled: SelectableMod[];
}

// 作者の普段の組み合わせ。同じサーバーで遊ぶ友人は設定しなくてよい
export const DEFAULT_MOD_SETTINGS: ModSettings = { enabled: ["circulation", "breathing", "rhs"] };

const MODS_KEY = "mods";
// known を保存する前（RHS を足す前）の保存は、ACE のモジュールだけを知っていた
const LEGACY_KNOWN: readonly SelectableMod[] = ACE_SELECTABLE_MODS;

export function isSelectableMod(value: unknown): value is SelectableMod {
  return SELECTABLE_MODS.some((mod) => mod === value);
}

/**
 * 保存の `known` は、保存した時点で設定の画面にあった MOD。後から足した MOD（known にないもの）は既定の値にする。
 * 保存済みの人にも、足した MOD を作者の普段の組み合わせで出すため（切った MOD は known にあるので切ったまま残る）。
 */
export function parseModSettings(value: unknown): ModSettings {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const enabled = record["enabled"];
  if (!Array.isArray(enabled)) {
    return DEFAULT_MOD_SETTINGS;
  }
  const items: unknown[] = enabled;
  const chosen = new Set(items.filter(isSelectableMod));
  const knownValue = record["known"];
  const knownItems: unknown[] = Array.isArray(knownValue) ? knownValue : [...LEGACY_KNOWN];
  const known = new Set(knownItems.filter(isSelectableMod));
  return {
    enabled: SELECTABLE_MODS.filter((mod) =>
      known.has(mod) ? chosen.has(mod) : DEFAULT_MOD_SETTINGS.enabled.includes(mod),
    ),
  };
}

/** 保存する形。known に今の設定の画面にある MOD を全部入れる */
export function serializeModSettings(settings: ModSettings): {
  enabled: SelectableMod[];
  known: SelectableMod[];
} {
  return { enabled: settings.enabled, known: [...SELECTABLE_MODS] };
}

/** branch ノードの判定に使う、有効な MOD の集合 */
export function activeMods(settings: ModSettings): ActiveMods {
  return new Set<ModTarget>([...ALWAYS_ACTIVE_MODS, ...settings.enabled]);
}

/** 「Core + Circulation + Breathing + RHS」の形の 1 行 */
export function modSummary(settings: ModSettings): string {
  const mods: ModTarget[] = ["core", ...settings.enabled];
  return mods.map((mod) => MOD_TARGET_LABELS[mod]).join(" + ");
}

interface ModSettingsState {
  settings: ModSettings;
  storageError: string | null;
  setEnabled: (mod: SelectableMod, enabled: boolean) => void;
}

export const useModSettings = create<ModSettingsState>()((set, get) => ({
  settings: DEFAULT_MOD_SETTINGS,
  storageError: null,
  setEnabled: (mod, enabled) => {
    const current = get().settings.enabled.filter((m) => m !== mod);
    const settings = parseModSettings({
      enabled: enabled ? [...current, mod] : current,
      known: SELECTABLE_MODS,
    });
    set({ settings });
    settingsSet(MODS_KEY, serializeModSettings(settings)).then(
      () => {
        set({ storageError: null });
      },
      (error: unknown) => {
        set({ storageError: errorMessage(error) });
      },
    );
  },
}));

/** 起動時と、小窓を出すたびに読む（設定はメインの設定画面で変えるため）。読めなければ既定値のまま。 */
export async function loadModSettings(): Promise<void> {
  try {
    useModSettings.setState({ settings: parseModSettings(await settingsGet(MODS_KEY)) });
  } catch (error: unknown) {
    useModSettings.setState({ storageError: errorMessage(error) });
  }
}
