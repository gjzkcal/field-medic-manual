// 記録の項目の表示名と、時間の書き方。
import type { CasualtyDrug } from "@/lib/bindings/CasualtyDrug";
import type { CasualtyEntry } from "@/lib/bindings/CasualtyEntry";
import type { TourniquetSite } from "@/lib/bindings/TourniquetSite";

export const DRUG_LABELS: Record<CasualtyDrug, string> = {
  epinephrine: "エピネフリン",
  morphine: "モルヒネ",
  metoprolol: "メトプロロール",
  naloxone: "ナロキソン",
  phenylephrine: "フェニレフリン",
  ammonium_carbonate: "炭酸アンモニウム",
};

/** ボタンの並び。Circulation なしでも使えるものを先に置く */
export const DRUG_ORDER: readonly CasualtyDrug[] = [
  "epinephrine",
  "morphine",
  "metoprolol",
  "naloxone",
  "phenylephrine",
  "ammonium_carbonate",
];

/** Circulation なしでも入手できる薬。ほかはボタンを隠す */
export const CORE_DRUGS: readonly CasualtyDrug[] = ["epinephrine", "morphine"];

export const SITE_LABELS: Record<TourniquetSite, string> = {
  left_arm: "左腕",
  right_arm: "右腕",
  left_leg: "左脚",
  right_leg: "右脚",
};

export const SITES: readonly TourniquetSite[] = ["left_arm", "right_arm", "left_leg", "right_leg"];

/** 履歴に出す 1 行。 */
export function entryLabel(entry: CasualtyEntry): string {
  switch (entry.kind) {
    case "drug":
      return DRUG_LABELS[entry.drug];
    case "saline":
      return "生理食塩水";
    case "tourniquet_on":
      return `止血帯を巻いた（${SITE_LABELS[entry.site]}）`;
    case "tourniquet_off":
      return `止血帯を外した（${SITE_LABELS[entry.site]}）`;
    case "note":
      return `メモ: ${entry.text}`;
  }
}

/** 残り時間と経過時間。60 s までは秒、それより長いときは分と秒で出す */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total <= 60) {
    return `${String(total)} s`;
  }
  const seconds = total % 60;
  return `${String(Math.floor(total / 60))}:${String(seconds).padStart(2, "0")}`;
}

/** 記録の時刻。 */
export function formatClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString("ja-JP", { hour12: false });
}
