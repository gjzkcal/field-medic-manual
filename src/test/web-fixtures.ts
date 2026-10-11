// Web 版の検索とメモリの表のテストに使う原稿とクイック表。
// デスクトップ版の Rust のテスト（src-tauri/src/db/fixtures.rs、quickref.rs の fixtures）と同じ中身にして、
// 同じ語で同じ結果になることを確かめる。
import type { NormalizedDoc, NormalizedSection } from "@/features/content/types";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";

export function section(
  level: number,
  title: string,
  anchor: string,
  plainText: string,
  tags: string[] = [],
): NormalizedSection {
  return {
    level,
    title,
    anchor,
    html: plainText === "" ? "" : `<p>${plainText}</p>`,
    plainText,
    tags,
    mods: [],
    withoutMods: [],
  };
}

export function doc(
  title: string,
  fileName: string,
  modTarget: ModTarget | null,
  modChannel: ModChannel | null,
  tags: string[],
  sections: NormalizedSection[],
): NormalizedDoc {
  return {
    title,
    sourceType: "markdown",
    sourcePath: `bundle://manuals/${fileName}`,
    sourceHash: `hash-of-${fileName}`,
    meta: {
      modTarget,
      modChannel,
      modVersion: null,
      verifiedAt: null,
      aceCommit: null,
      gameVersion: null,
      tags,
      order: null,
      category: null,
    },
    sections,
    assets: [],
  };
}

export function bleeding(): NormalizedDoc {
  return doc(
    "出血",
    "bleeding.md",
    "core",
    null,
    ["出血"],
    [
      section(1, "出血", "bleeding", "【要確認】出血への対応の骨子。"),
      section(
        2,
        "出血の見分け方",
        "bleeding-signs",
        "【要確認】出血の程度（Class I〜IV）を確認する。",
        ["圧迫止血"],
      ),
    ],
  );
}

export function cpr(): NormalizedDoc {
  const d = doc(
    "心停止と CPR",
    "cpr.md",
    "circulation",
    "dev",
    ["循環"],
    [section(1, "CPR の手順", "cpr-steps", "【要確認】心停止のときは CPR を行う。")],
  );
  d.meta.modVersion = "1.5.36";
  return d;
}

export function tourniquet(): NormalizedDoc {
  return doc(
    "止血帯",
    "tourniquet.md",
    "general",
    null,
    ["止血帯"],
    [section(1, "止血帯を使う", "use-tourniquet", "【要確認】四肢の大量出血には止血帯を使う。")],
  );
}

function row(id: string, category: string, symptom: string, severity: number): QuickrefRow {
  return {
    id,
    category,
    symptom,
    severity,
    treatment: ["包帯を巻く"],
    items: ["包帯"],
    notes: null,
    links: ["doc:hemorrhage.md#包帯を巻く"],
    mods: [],
    withoutMods: [],
  };
}

/** 気胸（Breathing）・大出血・意識不明（Circulation の有無で 2 行）の 4 行。 */
export function quickrefTable(): QuickrefTable {
  return {
    sourceHash: "hash",
    modChannel: "dev",
    verifiedAt: "2026-09-28",
    rows: [
      {
        ...row("tension-ptx", "気道・呼吸", "緊張性気胸", 4),
        treatment: ["NCD キットで脱気する"],
        items: ["NCD キット"],
        notes: "診察で Tension pneumothorax と出る",
        mods: ["breathing"],
      },
      {
        ...row("limb-bleeding", "出血", "手足から大量に出血している", 4),
        treatment: ["包帯を巻く", "止まらなければ止血帯を使う"],
      },
      {
        ...row("unconscious-circulation", "意識", "意識不明", 3),
        treatment: ["炭酸アンモニウムを嗅がせる"],
        items: ["炭酸アンモニウム"],
        mods: ["circulation"],
      },
      {
        ...row("unconscious-core", "意識", "意識不明", 3),
        treatment: ["エピネフリンを注射する"],
        items: ["エピネフリン"],
        withoutMods: ["circulation"],
      },
    ],
  };
}

export const EMPTY_QUICKREF: QuickrefTable = {
  sourceHash: null,
  modChannel: null,
  verifiedAt: null,
  rows: [],
};
