// AI が負傷者の記録を読んだとき（casualty_read）に返す文。負傷者の画面のカードと同じ計算を使い、
// AI が自分で薬の効きを計算し直さなくてよいようにする（式を間違えると、次に打てる時刻を誤って案内するため）。
import {
  activeTourniquets,
  ammoniumTimes,
  dosesOf,
  lastDoseAtMs,
  lastSalineAtMs,
} from "@/features/casualties/casualty-view";
import { primaryText, secondaryTexts } from "@/features/casualties/drug-display";
import { buildForecasts, drugTimers } from "@/features/casualties/forecast";
import { DRUG_LABELS, entryLabel, SITE_LABELS } from "@/features/casualties/labels";
import { overdoseTimer } from "@/features/casualties/overdose";
import type { OverdoseLine } from "@/features/medication/overdose-line";
import type { MedicationFile } from "@/features/medication/schema";
import type { Casualty } from "@/lib/bindings/Casualty";

export interface CasualtyBriefInput {
  casualties: readonly Casualty[];
  medication: MedicationFile;
  /** Circulation を使っているか。使っていなければ、薬の効きではなく「次を打てるまで」を出す（画面と同じ） */
  circulation: boolean;
  overdoseLine: OverdoseLine;
  nowMs: number;
}

const LINE_LABELS: Record<OverdoseLine, string> = {
  unconscious: "意識を失う（Critical）手前",
  arrest: "心停止の手前",
};

/** 「3 分 12 秒」の形。AI が分と秒を取り違えないよう、単位を書く */
export function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes === 0 ? `${String(seconds)} 秒` : `${String(minutes)} 分 ${String(seconds)} 秒`;
}

function drugLines(casualty: Casualty, input: CasualtyBriefInput): string[] {
  const { medication, nowMs, overdoseLine } = input;
  const doses = dosesOf(casualty.records);
  if (doses.length === 0) {
    return [];
  }
  return buildForecasts(medication, doses)
    .filter((f) => f.clearAtMs > nowMs)
    .map((forecast) => {
      const timers = drugTimers(forecast, nowMs);
      const effects = [
        primaryText(medication, forecast.drug, forecast.doses, nowMs),
        ...secondaryTexts(medication, forecast.drug, forecast.doses, nowMs),
      ].join("、");
      const until = [
        timers.nextPeakAtMs === null
          ? null
          : `ピークまで ${spokenDuration(timers.nextPeakAtMs - nowMs)}`,
        timers.halfAtMs === null ? null : `半分まで ${spokenDuration(timers.halfAtMs - nowMs)}`,
        `消えるまで ${spokenDuration(timers.clearAtMs - nowMs)}`,
      ].filter((t) => t !== null);
      const overdose = overdoseTimer(
        medication,
        forecast.drug,
        forecast.doses,
        overdoseLine,
        casualty.inPain,
      );
      const limit =
        overdose.kind === "danger"
          ? "過量投与: 1 本でも危険"
          : overdose.kind === "limit"
            ? overdose.safeAtMs <= nowMs
              ? `過量投与: 今なら同時に ${String(overdose.doses)} 本まで打てる`
              : `過量投与: 同時に ${String(overdose.doses)} 本まで打てるのは ${spokenDuration(overdose.safeAtMs - nowMs)} 後`
            : null;
      return [
        `- ${DRUG_LABELS[forecast.drug]}（${String(forecast.doseCount)} 本、最後は ${spokenDuration(nowMs - forecast.lastAtMs)} 前）: ${effects}。${until.join("、")}`,
        ...(limit === null ? [] : [`  ${limit}`]),
      ].join("\n");
    });
}

function casualtyText(casualty: Casualty, input: CasualtyBriefInput): string {
  const { medication, nowMs, circulation } = input;
  const lines = [
    `## 負傷者「${casualty.name}」（id: ${casualty.id}）`,
    `痛み・気胸: ${casualty.inPain ? "あり" : "なし"}`,
  ];
  if (casualty.records.length === 0) {
    lines.push("記録: なし");
  } else {
    lines.push(
      "記録（古い順。[記録の id] 経過 内容）:",
      ...casualty.records.map(
        (r) => `- [${r.id}] ${spokenDuration(nowMs - r.atMs)} 前 ${entryLabel(r.entry)}`,
      ),
    );
  }
  if (circulation) {
    const drugs = drugLines(casualty, input);
    if (drugs.length > 0) {
      lines.push("今効いている薬:", ...drugs);
    }
    const ammonium = ammoniumTimes(casualty.records);
    if (ammonium.length > 0) {
      lines.push(
        `${DRUG_LABELS.ammonium_carbonate}: ${ammonium.map((at) => `${spokenDuration(nowMs - at)} 前`).join("、")}（濃度の計算はない）`,
      );
    }
  } else {
    const locks = (["epinephrine", "morphine"] as const).flatMap((drug) => {
      const at = lastDoseAtMs(casualty.records, drug);
      const untilMs = at === null ? 0 : at + medication.coreLockSeconds[drug] * 1000;
      return untilMs > nowMs
        ? [`${DRUG_LABELS[drug]}: 次を打てるまで ${spokenDuration(untilMs - nowMs)}`]
        : [];
    });
    if (locks.length > 0) {
      lines.push("Circulation なしの打てない時間:", ...locks.map((l) => `- ${l}`));
    }
  }
  const salineAtMs = lastSalineAtMs(casualty.records);
  if (salineAtMs !== null) {
    const endsAtMs = salineAtMs + medication.salineSeconds * 1000;
    if (endsAtMs > nowMs) {
      lines.push(`生理食塩水: 入れ終わるまで ${spokenDuration(endsAtMs - nowMs)}`);
    }
  }
  const tourniquets = activeTourniquets(casualty.records);
  if (tourniquets.length > 0) {
    lines.push(
      `巻いている止血帯: ${tourniquets
        .map(
          ({ site, sinceMs }) =>
            `${SITE_LABELS[site]}（${spokenDuration(nowMs - sinceMs)} 前から）`,
        )
        .join("、")}`,
    );
  }
  return lines.join("\n");
}

/** 全員の記録と、今の時点の計算。 */
export function casualtyBrief(input: CasualtyBriefInput): string {
  const head = [
    `# 負傷者の記録（${String(input.casualties.length)} 人）`,
    `Circulation: ${input.circulation ? "あり" : "なし"}。過量投与の目安は「${LINE_LABELS[input.overdoseLine]}」まで（利用者の設定）。`,
    "計算は、この記録にある投与だけを使う（記録していない投与は入らない）。",
  ].join("\n");
  if (input.casualties.length === 0) {
    return `${head}\n負傷者は記録されていません。`;
  }
  return [head, ...input.casualties.map((c) => casualtyText(c, input))].join("\n\n");
}
