// 検索の性能を確かめるためのダミーデータ（開発ビルドのデバッグ画面だけで使う）。
// 同梱の原稿ではないので、次の起動時の同期（同梱にないドキュメントは消す）でも消える。
import { MOD_TARGET_VALUES } from "@/features/content/meta";
import type { DocUpsertInput } from "@/lib/bindings/DocUpsertInput";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { SectionInput } from "@/lib/bindings/SectionInput";
import { docDelete, docList, docUpsert } from "@/lib/tauri";

export const DUMMY_SOURCE_PREFIX = "debug://dummy/";
const DOC_COUNT = 50;
const SECTIONS_PER_DOC = 20;

// 実際の検索語（1〜2 文字の「脈」「CPR」、同義語の「止血帯」など）が当たるよう、ACE Medical の用語を混ぜる。
// 処置の内容としては意味を持たせない
const PHRASES = [
  "脈を確かめる",
  "止血帯を巻いた時刻を記録する",
  "出血の程度を見る",
  "CPR を続ける",
  "気道を確保する",
  "モルヒネの量に気を付ける",
  "エピネフリンを使う場面",
  "チェストシールを貼る",
  "心停止を疑う",
  "意識の有無を確かめる",
  "包帯を巻く",
  "King LT を入れる",
  "NCD キットの出番",
  "炭酸アンモニウムを嗅がせる",
  "呼吸の回数を数える",
  "血圧が下がる",
  "痛みで動けない",
  "回復体位にする",
  "味方に声をかける",
  "周りの安全を確かめる",
] as const;
const CHANNELS: readonly (ModChannel | null)[] = [null, "release", "dev"];

// 何度作っても同じ中身になるよう、乱数ではなく番号から句を選ぶ
function phraseAt(n: number): string {
  return PHRASES[(n * 7 + 3) % PHRASES.length] ?? "";
}

function dummySection(docIndex: number, sectionIndex: number): SectionInput {
  const seed = docIndex * SECTIONS_PER_DOC + sectionIndex;
  const sentences = Array.from({ length: 8 }, (_, i) => `${phraseAt(seed + i * 5)}。`);
  const plainText = `【要確認】ダミーの本文 ${String(seed)}。${sentences.join("")}`;
  const title =
    sectionIndex === 0
      ? `ダミー文書 ${String(docIndex + 1)}`
      : `${phraseAt(seed)}（${String(sectionIndex)}）`;
  return {
    level: sectionIndex === 0 ? 1 : 2,
    title,
    anchor: `dummy-${String(sectionIndex)}`,
    // 句はこのファイルの定数だけで、HTML として特別な文字を含まない
    html: `<p>${plainText}</p>`,
    plainText,
    page: null,
    tags: sectionIndex % 5 === 0 ? ["ダミー"] : [],
  };
}

export function makeDummyDocs(): DocUpsertInput[] {
  return Array.from({ length: DOC_COUNT }, (_, d) => ({
    title: `ダミー文書 ${String(d + 1)}`,
    sourceType: "text",
    sourcePath: `${DUMMY_SOURCE_PREFIX}${String(d + 1).padStart(2, "0")}`,
    sourceHash: "dummy",
    meta: {
      modTarget: MOD_TARGET_VALUES[d % MOD_TARGET_VALUES.length] ?? null,
      modChannel: CHANNELS[d % CHANNELS.length] ?? null,
      modVersion: null,
      verifiedAt: null,
      tags: ["ダミー"],
    },
    sections: Array.from({ length: SECTIONS_PER_DOC }, (_, s) => dummySection(d, s)),
    assetIds: [],
    originalAssetId: null,
  }));
}

/** ダミーを入れ、入れた節の数を返す。同じ sourcePath なら置き換わるので、何度押しても増えない。 */
export async function insertDummyDocs(): Promise<number> {
  const docs = makeDummyDocs();
  for (const doc of docs) {
    await docUpsert(doc);
  }
  return docs.reduce((sum, doc) => sum + doc.sections.length, 0);
}

/** ダミーを消し、消した文書の数を返す。 */
export async function removeDummyDocs(): Promise<number> {
  const dummies = (await docList()).filter(
    (doc) => doc.sourcePath?.startsWith(DUMMY_SOURCE_PREFIX) === true,
  );
  for (const doc of dummies) {
    await docDelete(doc.id);
  }
  return dummies.length;
}
