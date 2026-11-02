// 計算が原稿の表と同じ値を出すことを確かめる。原稿か content/medication.yaml の片方だけを直すと、ここで落ちる。
import { describe, expect, it } from "vitest";

import { bundledManuals, readBundledData } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { loadMedication } from "@/features/medication/bundle";
import {
  antagonismRatio,
  doseConcentration,
  doseExpirySeconds,
  drugConfig,
  drugEffect,
  peakSeconds,
  singleDosePeak,
} from "@/features/medication/pharmacology";
import { parseMedication, type DrugConfig, type DrugId } from "@/features/medication/schema";
import { readRepoFile } from "@/test/samples";

const DRUG_OF_LABEL: Readonly<Record<string, DrugId>> = {
  エピネフリン: "epinephrine",
  メトプロロール: "metoprolol",
  モルヒネ: "morphine",
  ナロキソン: "naloxone",
  フェニレフリン: "phenylephrine",
};

const medication = await loadMedication();
const manuals = await bundledManuals();

function manualText(name: string): string {
  const manual = manuals.find((m) => m.fileName === name);
  if (manual === undefined) {
    throw new Error(`原稿がありません: ${name}`);
  }
  return manual.text;
}

const drugEffects = manuals.find((m) => m.fileName === "drug-effects.md");
if (drugEffects === undefined) {
  throw new Error("drug-effects.md がありません");
}
const { doc } = await convertManual(drugEffects, readRepoFile, readBundledData);

/** 節の中の、薬の名前が先頭の列にある表の行。列は見出しの書き方に左右されないよう位置で読む */
function drugRows(sectionTitle: string, tableIndex = 0): [DrugId, string[]][] {
  const section = doc.sections.find((s) => s.title === sectionTitle);
  if (section === undefined) {
    throw new Error(`節がありません: ${sectionTitle}`);
  }
  const container = document.createElement("div");
  container.innerHTML = section.html;
  const table = container.querySelectorAll("table")[tableIndex];
  if (table === undefined) {
    throw new Error(`表がありません: ${sectionTitle}`);
  }
  return Array.from(table.tBodies[0]?.rows ?? []).flatMap((row) => {
    const cells = Array.from(row.cells, (cell) => cell.textContent.trim());
    const drug = DRUG_OF_LABEL[cells[0] ?? ""];
    return drug === undefined ? [] : [[drug, cells.slice(1)]];
  });
}

/** 「+25.2 bpm」「−4.9%」「0.685」「1.429 倍」の数値。「変化なし」は null */
function cellNumber(cell: string | undefined): number | null {
  if (cell === undefined || cell === "変化なし") {
    return null;
  }
  return Number.parseFloat(cell.replace("−", "-").replace("+", ""));
}

/** 山を過ぎて最大の半分まで下がる時刻を二分法で探す */
function halfSeconds(drug: DrugConfig): number {
  const target = doseConcentration(drug, peakSeconds(drug)) / 2;
  let low = peakSeconds(drug);
  let high = doseExpirySeconds(drug);
  for (let i = 0; i < 60; i += 1) {
    const middle = (low + high) / 2;
    if (doseConcentration(drug, middle) > target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

describe("薬の効き方の表", () => {
  const rows = drugRows("濃度の式", 1);

  it("5 つの薬がすべて表にある", () => {
    expect(rows.map(([drug]) => drug).toSorted()).toEqual(
      medication.drugs.map((d) => d.id).toSorted(),
    );
  });

  it.each(rows)("%s: 量・吸収・消える速さ・時刻が原稿と同じ", (id, cells) => {
    const drug = drugConfig(medication, id);
    expect(drug.doseNm).toBe(Number(cells[0]));
    expect(drug.activationRate).toBe(Number(cells[1]));
    expect(drug.deactivationRate).toBe(Number(cells[2]));
    expect(Math.abs(peakSeconds(drug) - (cellNumber(cells[3]) ?? 0))).toBeLessThanOrEqual(0.051);
    expect(
      Math.abs(doseConcentration(drug, peakSeconds(drug)) - (cellNumber(cells[4]) ?? 0)),
    ).toBeLessThanOrEqual(0.051);
    // 原稿の半分の時刻は 0.1 s 刻みで切り上げた値がある（フェニレフリンは 78.749 s を 78.8 s と書いている）
    expect(Math.abs(halfSeconds(drug) - (cellNumber(cells[5]) ?? 0))).toBeLessThanOrEqual(0.06);
    expect(doseExpirySeconds(drug)).toBe(cellNumber(cells[6]));
  });

  it("計算例: エピネフリン 1 本、10 s 後に 185.7 nM", () => {
    expect(doseConcentration(drugConfig(medication, "epinephrine"), 10)).toBeCloseTo(185.7, 0);
  });
});

describe("1 本のピークでの効果の表", () => {
  const rows = drugRows("効果の式", 1);

  it.each(rows)("%s: 効果が原稿と同じ", (id, cells) => {
    const drug = drugConfig(medication, id);
    const concentrations = { [id]: doseConcentration(drug, peakSeconds(drug)) };
    const heartRate = drugEffect(medication, "heartRate", id, concentrations);
    const resistance =
      (drugEffect(medication, "vascularResistance", id, concentrations) /
        medication.baseVascularResistance) *
      100;
    expect(Math.abs(heartRate - (cellNumber(cells[0]) ?? 0))).toBeLessThanOrEqual(0.051);
    expect(Math.abs(resistance - (cellNumber(cells[1]) ?? 0))).toBeLessThanOrEqual(0.051);
    expect(
      Math.abs(
        drugEffect(medication, "analgesia", id, concentrations) - (cellNumber(cells[2]) ?? 0),
      ),
    ).toBeLessThanOrEqual(0.00051);
    expect(
      Math.abs(
        1 -
          drugEffect(medication, "bleedingRate", id, concentrations) -
          (cellNumber(cells[3]) ?? 0),
      ),
    ).toBeLessThanOrEqual(0.00051);
    expect(
      Math.abs(
        1 +
          drugEffect(medication, "reviveFrequency", id, concentrations) -
          (cellNumber(cells[4]) ?? 0),
      ),
    ).toBeLessThanOrEqual(0.00051);
  });
});

describe("原稿の別の場所にある値", () => {
  it("ナロキソンの効き方の 120 が原稿と同じ", () => {
    const value = medication.effects
      .flatMap((e) => e.drugs)
      .flatMap((d) => d.antagonists ?? [])
      .map((a) => a.ec50);
    expect(new Set(value)).toEqual(new Set([120]));
    expect(manualText("naloxone.md")).toContain("(1 + C_{\\text{nal}} \\div 120)");
  });

  it("既定の血管抵抗が原稿と同じ", () => {
    expect(manualText("vitals-system.md")).toContain(String(medication.baseVascularResistance));
  });

  it("生理食塩水の時間と、Circulation なしで次を打てない時間が原稿と同じ", () => {
    expect(manualText("saline.md")).toContain(
      `血液量の 25% を ${String(medication.salineSeconds)} s かけて入れる`,
    );
    expect(manualText("epinephrine.md")).toContain(
      `4 HP/s で ${String(medication.coreLockSeconds.epinephrine)} s 回復`,
    );
    expect(manualText("morphine.md")).toContain(
      `2.5 HP/s で ${String(medication.coreLockSeconds.morphine)} s 回復`,
    );
  });
});

describe("効果の計算", () => {
  it("メトプロロールは ka と kd がほとんど同じでも値が崩れない", () => {
    const drug = drugConfig(medication, "metoprolol");
    expect(doseConcentration(drug, 25.82)).toBeCloseTo(176.6, 0);
    expect(doseConcentration(drug, 1)).toBeCloseTo(17.884, 2);
  });

  it("打つ前と消えた後は 0", () => {
    const drug = drugConfig(medication, "epinephrine");
    expect(doseConcentration(drug, -1)).toBe(0);
    expect(doseConcentration(drug, 0)).toBe(0);
    expect(doseConcentration(drug, doseExpirySeconds(drug))).toBe(0);
  });

  it("モルヒネの鎮痛は、濃度 25% でピークの約 12%", () => {
    const peak = singleDosePeak(medication, "morphine");
    const concentration = 0.25 * doseConcentration(drugConfig(medication, "morphine"), 117.9);
    const value = drugEffect(medication, "analgesia", "morphine", { morphine: concentration });
    expect(value / peak).toBeCloseTo(0.12, 1);
  });

  it("ナロキソンがピークなら、モルヒネの濃度が 100% でも鎮痛はピークの約 7%", () => {
    const morphine = doseConcentration(drugConfig(medication, "morphine"), 117.9);
    const naloxone = doseConcentration(drugConfig(medication, "naloxone"), 96);
    const value = drugEffect(medication, "analgesia", "morphine", { morphine, naloxone });
    expect(value / singleDosePeak(medication, "morphine")).toBeCloseTo(0.07, 1);
  });

  it("ナロキソンの計算例: 心拍数への効果が −2.59 bpm になる", () => {
    const value = drugEffect(medication, "heartRate", "morphine", { morphine: 540, naloxone: 486 });
    expect(value).toBeCloseTo(-2.59, 2);
  });

  it("ナロキソンの主な効能は、モルヒネの濃度を割る分の割合", () => {
    expect(antagonismRatio(medication, {})).toBe(0);
    expect(antagonismRatio(medication, { naloxone: 120 })).toBeCloseTo(0.5, 5);
  });

  it("体内の濃度は本ごとに足し合わせると効能も増える", () => {
    const drug = drugConfig(medication, "epinephrine");
    const single = doseConcentration(drug, 10);
    const one = drugEffect(medication, "heartRate", "epinephrine", { epinephrine: single });
    const two = drugEffect(medication, "heartRate", "epinephrine", { epinephrine: single * 2 });
    expect(two).toBeCloseTo(one * 2, 5);
  });
});

describe("値の読み込み", () => {
  it("不正な値は、どこが違うかを文言にして失敗する", () => {
    expect(() => parseMedication({ drugs: [] })).toThrow(/薬の数値を読めません/);
  });
});
