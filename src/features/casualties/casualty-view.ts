// 記録を、カードに出す形に整理する。画面と保存に依存しない純粋な関数にしてテストする。
import type { Dose } from "@/features/casualties/forecast";
import { DRUG_IDS, type DrugId } from "@/features/medication/schema";
import type { CasualtyDrug } from "@/lib/bindings/CasualtyDrug";
import type { CasualtyRecord } from "@/lib/bindings/CasualtyRecord";
import type { TourniquetSite } from "@/lib/bindings/TourniquetSite";

function isDrugId(drug: CasualtyDrug): drug is DrugId {
  return DRUG_IDS.some((id) => id === drug);
}

/** 濃度の仕組みがある薬の投与。 */
export function dosesOf(records: readonly CasualtyRecord[]): Dose[] {
  return records.flatMap(({ entry, atMs }) =>
    entry.kind === "drug" && isDrugId(entry.drug) ? [{ drug: entry.drug, atMs }] : [],
  );
}

/** 生理食塩水の、最後の 1 袋を入れ始めた時刻。1 人に 1 袋ずつなので最後の分だけを見る */
export function lastSalineAtMs(records: readonly CasualtyRecord[]): number | null {
  return records.findLast((r) => r.entry.kind === "saline")?.atMs ?? null;
}

/** 今巻いている止血帯の、部位ごとの巻いた時刻。 */
export function activeTourniquets(
  records: readonly CasualtyRecord[],
): { site: TourniquetSite; sinceMs: number }[] {
  const active = new Map<TourniquetSite, number>();
  for (const { entry, atMs } of records) {
    if (entry.kind === "tourniquet_on") {
      active.set(entry.site, atMs);
    } else if (entry.kind === "tourniquet_off") {
      active.delete(entry.site);
    }
  }
  return [...active].map(([site, sinceMs]) => ({ site, sinceMs }));
}

/** 炭酸アンモニウムを打った時刻。濃度の仕組みがないので、時刻だけを出す */
export function ammoniumTimes(records: readonly CasualtyRecord[]): number[] {
  return records.flatMap(({ entry, atMs }) =>
    entry.kind === "drug" && entry.drug === "ammonium_carbonate" ? [atMs] : [],
  );
}

/** 最後に打った時刻。Circulation なしの「次を打てるまで」に使う */
export function lastDoseAtMs(
  records: readonly CasualtyRecord[],
  drug: CasualtyDrug,
): number | null {
  return records.findLast((r) => r.entry.kind === "drug" && r.entry.drug === drug)?.atMs ?? null;
}

/** 名前を入れなかったときの「負傷者 N」。消した番号を埋め、同じ名前を作らない */
export function nextCasualtyName(names: readonly string[]): string {
  const used = new Set(names);
  let n = 1;
  while (used.has(`負傷者 ${String(n)}`)) {
    n += 1;
  }
  return `負傷者 ${String(n)}`;
}
