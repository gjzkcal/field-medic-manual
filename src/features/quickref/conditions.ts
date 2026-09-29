// クイック表の行の表示条件。設定の「使っている MOD」に合う行だけを出す。
import { MOD_TARGET_LABELS } from "@/features/content/meta";
import { modsActive, type ActiveMods } from "@/features/triage/runner";
import type { ModTarget } from "@/lib/bindings/ModTarget";

export interface RowConditions {
  /** すべて有効なときに出す */
  mods: readonly ModTarget[];
  /** どれも無効なときに出す */
  withoutMods: readonly ModTarget[];
}

export function isRowVisible(row: RowConditions, active: ActiveMods): boolean {
  // 判定は branch ノードと同じ（core と general は常に有効）
  return modsActive(row.mods, active) && !row.withoutMods.some((m) => modsActive([m], active));
}

/** 「Circulation あり・Breathing なし」の形。条件がなければ null */
export function conditionLabel(row: RowConditions): string | null {
  const parts = [
    ...row.mods.map((m) => `${MOD_TARGET_LABELS[m]} あり`),
    ...row.withoutMods.map((m) => `${MOD_TARGET_LABELS[m]} なし`),
  ];
  return parts.length === 0 ? null : parts.join("・");
}
