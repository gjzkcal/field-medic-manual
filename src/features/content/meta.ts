// front matter や <meta> に書かれたメタデータを DocMeta に直す。
// 原稿に書く項目は mod（対象モジュール）・channel（release / dev）・mod_version・verified_at（確認日）・tags・order（並び順）・category（分類）。
import type { DocMeta } from "@/lib/bindings/DocMeta";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";

// Record にしておくと、Rust 側で値が増えたときに表示名の書き漏れがコンパイルエラーになる
export const MOD_TARGET_LABELS: Record<ModTarget, string> = {
  core: "Core",
  hitzones: "Hitzones",
  circulation: "Circulation",
  breathing: "Breathing",
  defibrillation: "Defibrillation",
  ai: "AI",
  general: "一般",
};
export const MOD_CHANNEL_LABELS: Record<ModChannel, string> = { release: "Release", dev: "Dev" };

export const MOD_TARGET_VALUES = Object.keys(MOD_TARGET_LABELS).filter(isModTarget);

export function isModTarget(value: string): value is ModTarget {
  return Object.hasOwn(MOD_TARGET_LABELS, value);
}

export function isModChannel(value: string): value is ModChannel {
  return Object.hasOwn(MOD_CHANNEL_LABELS, value);
}

export function emptyMeta(): DocMeta {
  return {
    modTarget: null,
    modChannel: null,
    modVersion: null,
    verifiedAt: null,
    tags: [],
    order: null,
    category: null,
  };
}

/** 原稿に書かれた値（型は未確定）。 */
export interface RawMeta {
  mod?: unknown;
  channel?: unknown;
  modVersion?: unknown;
  verifiedAt?: unknown;
  tags?: unknown;
  order?: unknown;
  category?: unknown;
}

/** 値を検証して DocMeta にする。不正な値は捨てて warnings に積む（取り込みは止めない）。 */
export function toDocMeta(raw: RawMeta, warnings: string[]): DocMeta {
  const meta = emptyMeta();

  const mod = scalarText(raw.mod)?.toLowerCase();
  if (mod !== undefined) {
    if (isModTarget(mod)) {
      meta.modTarget = mod;
    } else {
      warnings.push(`mod の値が不明です: ${mod}（${MOD_TARGET_VALUES.join(" / ")} のどれか）`);
    }
  }

  const channel = scalarText(raw.channel)?.toLowerCase();
  if (channel !== undefined) {
    if (isModChannel(channel)) {
      meta.modChannel = channel;
    } else {
      warnings.push(`channel の値が不明です: ${channel}（release / dev のどちらか）`);
    }
  }

  meta.modVersion = scalarText(raw.modVersion) ?? null;

  const verifiedAt =
    raw.verifiedAt instanceof Date
      ? raw.verifiedAt.toISOString().slice(0, 10)
      : scalarText(raw.verifiedAt);
  if (verifiedAt !== undefined) {
    if (isIsoDate(verifiedAt)) {
      meta.verifiedAt = verifiedAt;
    } else {
      warnings.push(`verified_at は YYYY-MM-DD で書いてください: ${verifiedAt}`);
    }
  }

  meta.tags = parseTags(raw.tags);

  if (raw.order !== undefined && raw.order !== null) {
    if (typeof raw.order === "number" && Number.isInteger(raw.order) && raw.order >= 0) {
      meta.order = raw.order;
    } else {
      warnings.push(`order は 0 以上の整数で書いてください: ${JSON.stringify(raw.order)}`);
    }
  }

  if (raw.category !== undefined && raw.category !== null) {
    // 数値を受けると、YAML で `category: 2026` と書いた打ち間違いに気づけないので文字列だけにする
    if (typeof raw.category === "string") {
      meta.category = raw.category.trim() === "" ? null : raw.category.trim();
    } else {
      warnings.push(`category は文字列で書いてください: ${JSON.stringify(raw.category)}`);
    }
  }
  return meta;
}

/** タグの並び。配列か、`,` / `、` 区切りの文字列を受け付ける。 */
export function parseTags(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.map((v: unknown) => scalarText(v) ?? "")
    : (scalarText(value)?.split(/[,、，]/) ?? []);
  const tags = items.map((t) => t.trim()).filter((t) => t !== "");
  return [...new Set(tags)];
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 文字列・数値を空白を除いた文字列にする。空やそれ以外の型は undefined。YAML では `1.5` が数値になるため数値も受ける。 */
function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
