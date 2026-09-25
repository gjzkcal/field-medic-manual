// 開発用のサンプル。対象は dev-docs/reference/ace-medical-notes.md §4 に合わせる
// （「出血」= core・版不問、「CPR」= circulation・dev、「止血帯」= general）。
// 処置を確定させないため、本文は骨子だけにして【要確認】を付ける。
// sourcePath を固定しているので、何度投入しても同じドキュメントが置き換わるだけで増えない。
import type { DocUpsertInput } from "@/lib/bindings/DocUpsertInput";
import type { SectionInput } from "@/lib/bindings/SectionInput";

function section(
  level: number,
  title: string,
  anchor: string,
  text: string,
  tags: string[] = [],
): SectionInput {
  return { level, title, anchor, html: `<p>${text}</p>`, plainText: text, page: null, tags };
}

export const SAMPLE_DOCS: DocUpsertInput[] = [
  {
    title: "出血",
    sourceType: "markdown",
    sourcePath: "sample://bleeding",
    sourceHash: "sample-bleeding-v1",
    meta: {
      modTarget: "core",
      modChannel: null,
      modVersion: null,
      verifiedAt: null,
      tags: ["出血"],
    },
    sections: [
      section(
        1,
        "出血",
        "bleeding",
        "【要確認】出血への対応の骨子。版を問わない Core の内容として書く。",
      ),
      section(
        2,
        "出血の見分け方",
        "bleeding-signs",
        "【要確認】出血の程度（Class I〜IV）を確認する。",
        ["圧迫止血"],
      ),
      section(2, "包帯を巻く", "bandage", "【要確認】包帯（Bandage）で出血している部位を覆う。", [
        "包帯",
      ]),
    ],
    assetIds: [],
    originalAssetId: null,
  },
  {
    title: "心停止と CPR",
    sourceType: "markdown",
    sourcePath: "sample://cpr",
    sourceHash: "sample-cpr-v1",
    meta: {
      modTarget: "circulation",
      modChannel: "dev",
      modVersion: "1.5.36",
      verifiedAt: null,
      tags: ["循環"],
    },
    sections: [
      section(
        1,
        "CPR の手順",
        "cpr-steps",
        "【要確認】心停止のときは CPR を行う。Circulation を入れた Dev 版の機能。",
      ),
      section(
        2,
        "エピネフリンの役割",
        "epinephrine",
        "【要確認】Circulation を入れると、エピネフリンの役割が変わる。",
        ["薬剤"],
      ),
    ],
    assetIds: [],
    originalAssetId: null,
  },
  {
    title: "止血帯",
    sourceType: "markdown",
    sourcePath: "sample://tourniquet",
    sourceHash: "sample-tourniquet-v1",
    meta: {
      modTarget: "general",
      modChannel: null,
      modVersion: null,
      verifiedAt: null,
      tags: ["止血帯"],
    },
    sections: [
      section(1, "止血帯を使う", "use-tourniquet", "【要確認】四肢の大量出血には止血帯を使う。"),
      section(2, "外すときの注意", "remove-tourniquet", "【要確認】外すときの注意点を書く。"),
    ],
    assetIds: [],
    originalAssetId: null,
  },
];
