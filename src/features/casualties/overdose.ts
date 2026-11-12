// 「N 本まで OK まで」の計算。薬 1 種類で、患者の状態（痛み、血液 100%）を決めれば、過量投与は
// 「濃度の合計が線（原稿の本数 × 1 本のピークの濃度）を超えたら危ない」と言い換えられる。
// 心拍数が目標に追いつくまでの遅れは無視しているので、ACE の 1 s ごとの計算と突き合わせるテスト（overdose.ace.test.ts）で守る。
import {
  doseConcentration,
  doseExpirySeconds,
  drugConfig,
  peakSeconds,
} from "@/features/medication/pharmacology";
import type { Dose } from "@/features/casualties/forecast";
import type { OverdoseLine } from "@/features/medication/overdose-line";
import type { DrugId, MedicationFile } from "@/features/medication/schema";

export type OverdoseLimit =
  /** 過量投与がない（ナロキソン） */
  | { kind: "none" }
  /** 何も打っていなくても 1 本で危ない */
  | { kind: "danger" }
  /** doses 本までなら、何も打っていないときは同時に打っても大丈夫。threshold は危なくなる本数 */
  | { kind: "limit"; doses: number; threshold: number };

/**
 * 線の計算は ACE の計算より最大 2 s 短く出る。それと、記録を押した時刻と実際に打った時刻のずれを吸収するため、少し長めに出す
 */
export const SAFETY_MARGIN_MS = 10_000;
const MS = 1000;

/**
 * 危なくなる本数と、何本まで打てるか。痛み・気胸ありは「痛みがあるかもしれない」として、痛みなしと激痛のうち
 * 少ない本数を使う。メトプロロールは痛みがあるほど本数が増えるので、激痛の本数を使うと中くらいの痛みで危ないため。
 * 本数は痛みの強さに対して単調に動くので、両端の少ないほうが中くらいの痛みも覆う。
 */
export function overdoseLimit(
  medication: MedicationFile,
  drug: DrugId,
  line: OverdoseLine,
  inPain: boolean,
): OverdoseLimit {
  const counts = drugConfig(medication, drug).overdoseDoses?.[line];
  if (counts === undefined) {
    return { kind: "none" };
  }
  const threshold = inPain ? Math.min(counts.noPain, counts.severePain) : counts.noPain;
  // 本数ちょうどで危なくなるので、それを下回る最大の整数
  const doses = Math.ceil(threshold) - 1;
  return doses < 1 ? { kind: "danger" } : { kind: "limit", doses, threshold };
}

/**
 * 今から limit.doses 本を同時に打っても、先の濃度の合計が線を超えなくなる時刻（Unix ms、長めの幅を含む）。
 * ownDoseAtMs はこの薬の、体内に残っている投与の時刻。時刻は最後の投与から 1 s 刻みで探す。
 */
export function safeAtMs(
  medication: MedicationFile,
  drug: DrugId,
  ownDoseAtMs: readonly number[],
  limit: { doses: number; threshold: number },
): number {
  const config = drugConfig(medication, drug);
  const expiry = doseExpirySeconds(config);
  const peak = peakSeconds(config);
  const line = limit.threshold * doseConcentration(config, peak);
  const lastAtMs = Math.max(...ownDoseAtMs);
  // 最後の投与から expiry 秒後には前の分がすべて消え、N 本だけでは線に届かないので、そこまで探せば足りる。
  // 打った後の分まで見るので、前の分の濃度は 2 倍の長さまで用意する（消えた後は 0）
  const previous = Array.from({ length: 2 * expiry + 1 }, (_, j) =>
    ownDoseAtMs.reduce(
      (sum, at) => sum + doseConcentration(config, (lastAtMs + j * MS - at) / MS),
      0,
    ),
  );
  const added = Array.from(
    { length: expiry },
    (_, k) => limit.doses * doseConcentration(config, k),
  );
  const isSafe = (start: number): boolean =>
    added.every((value, k) => (previous[start + k] ?? 0) + value <= line);
  // 前の投与がすべてピークを過ぎると、前の分の濃度は下がる一方になり、一度安全になれば後も安全。
  // それまでは、まだ上がっている分と重なって安全でなくなることがあるので、1 s ずつ確かめる
  const monotoneFrom = Math.ceil(peak);
  let safeFrom: number | null = null;
  for (let start = 0; start <= expiry; start += 1) {
    if (isSafe(start)) {
      safeFrom ??= start;
      if (start >= monotoneFrom) {
        break;
      }
    } else {
      safeFrom = null;
    }
  }
  return lastAtMs + (safeFrom ?? expiry) * MS + SAFETY_MARGIN_MS;
}

export type OverdoseTimer =
  { kind: "none" } | { kind: "danger" } | { kind: "limit"; doses: number; safeAtMs: number };

/** 薬のカードの「N 本まで OK まで」。doses は体内に残っている投与（ほかの薬を含んでよい） */
export function overdoseTimer(
  medication: MedicationFile,
  drug: DrugId,
  doses: readonly Dose[],
  line: OverdoseLine,
  inPain: boolean,
): OverdoseTimer {
  const limit = overdoseLimit(medication, drug, line, inPain);
  const own = doses.filter((d) => d.drug === drug).map((d) => d.atMs);
  if (limit.kind !== "limit" || own.length === 0) {
    return limit.kind === "limit" ? { kind: "none" } : limit;
  }
  return { kind: "limit", doses: limit.doses, safeAtMs: safeAtMs(medication, drug, own, limit) };
}
