// 「この MOD を入れているとき / 入れていないときだけ出す」という表示条件。
// クイック表の行と原稿の節が、設定の「使っている MOD」に合うものだけを出すのに使う。
import { MOD_TARGET_LABELS } from "@/features/content/meta";
import { modsActive, type ActiveMods } from "@/features/triage/runner";
import type { ModTarget } from "@/lib/bindings/ModTarget";

export interface ModConditions {
  /** すべて有効なときに出す */
  mods: readonly ModTarget[];
  /** どれも無効なときに出す */
  withoutMods: readonly ModTarget[];
}

export function meetsModConditions(conditions: ModConditions, active: ActiveMods): boolean {
  // 判定は branch ノードと同じ（core と general は常に有効）
  return (
    modsActive(conditions.mods, active) &&
    !conditions.withoutMods.some((m) => modsActive([m], active))
  );
}

export function hasModConditions(conditions: ModConditions): boolean {
  return conditions.mods.length > 0 || conditions.withoutMods.length > 0;
}

/** 「Circulation あり・Breathing なし」の形。条件がなければ null */
export function conditionLabel(conditions: ModConditions): string | null {
  const parts = [
    ...conditions.mods.map((m) => `${MOD_TARGET_LABELS[m]} あり`),
    ...conditions.withoutMods.map((m) => `${MOD_TARGET_LABELS[m]} なし`),
  ];
  return parts.length === 0 ? null : parts.join("・");
}
