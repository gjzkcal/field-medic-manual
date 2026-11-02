// 効能の書き方。画面には濃度ではなく効能を出す（モルヒネの鎮痛は濃度の 2.7 乗で効き、ナロキソンでも弱まるので、
// 濃度とは大きく食い違うため）。
import { concentrationsAt, type Dose } from "@/features/casualties/forecast";
import { drugConfig, drugEffect, primaryEffect } from "@/features/medication/pharmacology";
import type { DrugId, MedicationFile } from "@/features/medication/schema";

function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  // 原稿と同じく、負の値は全角に近い長さのマイナス記号で書く
  return value < 0 ? `−${text}` : `+${text}`;
}

function resistancePercent(medication: MedicationFile, value: number): string {
  return `${signed((value / medication.baseVascularResistance) * 100, 1)}%`;
}

/** カードの大きな数値。 */
export function primaryText(
  medication: MedicationFile,
  drug: DrugId,
  doses: readonly Dose[],
  atMs: number,
): string {
  const value = primaryEffect(medication, drug, concentrationsAt(medication, doses, atMs));
  switch (drugConfig(medication, drug).primaryEffect) {
    case "heartRate":
      return `心拍数 ${signed(value, 1)} bpm`;
    case "analgesia":
      return `鎮痛 ${value.toFixed(2)}`;
    case "antagonism":
      return `モルヒネを ${String(Math.round(value * 100))}% 弱める`;
    case "bleedingRate":
      return `出血 ×${(1 - value).toFixed(2)}`;
    case "vascularResistance":
      return `血管抵抗 ${resistancePercent(medication, value)}`;
    case "reviveFrequency":
      return `蘇生判定の頻度 ×${(1 + value).toFixed(2)}`;
  }
}

/** 主な効能のほかの効果。カードに数値だけを出す。 */
export function secondaryTexts(
  medication: MedicationFile,
  drug: DrugId,
  doses: readonly Dose[],
  atMs: number,
): string[] {
  const concentrations = concentrationsAt(medication, doses, atMs);
  const heartRate = (): string =>
    `心拍数 ${signed(drugEffect(medication, "heartRate", drug, concentrations), 1)} bpm`;
  const resistance = (): string =>
    `血管抵抗 ${resistancePercent(
      medication,
      drugEffect(medication, "vascularResistance", drug, concentrations),
    )}`;
  switch (drug) {
    case "morphine":
      return [heartRate(), resistance()];
    case "epinephrine": {
      const revive = 1 + drugEffect(medication, "reviveFrequency", drug, concentrations);
      return [`蘇生判定の頻度 ×${revive.toFixed(2)}`];
    }
    case "phenylephrine":
      return [resistance()];
    case "metoprolol":
    case "naloxone":
      return [];
  }
}
