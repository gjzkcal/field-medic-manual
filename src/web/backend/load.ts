// 同梱した原稿とクイック表を変換して、Web 版の表を作る。本番はビルドのときに Node で（build-time.ts）、
// 開発サーバーとテストはブラウザ（jsdom）で、最初に使われたときに動く。
// デスクトップ版と同じ変換（Markdown → 無害化した HTML の節）を使うので、表示も検索もアプリと同じ原稿の内容になる。
import { bundledManuals, readBundledData, readBundledImage } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import type { NormalizedDoc, ReadImage } from "@/features/content/types";
import { bundledQuickref, readQuickrefSource } from "@/features/quickref/bundle";
import { toQuickrefRows } from "@/features/quickref/schema";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { buildStore, type WebStore } from "@/web/backend/store";

const EMPTY_QUICKREF: QuickrefTable = {
  sourceHash: null,
  modChannel: null,
  verifiedAt: null,
  rows: [],
};

/** 同梱物から Web 版の表を作る。 */
export async function loadWebStore(readImage: ReadImage = readBundledImage): Promise<WebStore> {
  const docs: NormalizedDoc[] = [];
  for (const manual of await bundledManuals()) {
    // 変換の警告（原稿の書き間違い）は原稿の検査（テスト）で 0 件にしてから公開するので、ここでは捨てる
    const { doc } = await convertManual(manual, readImage, readBundledData);
    docs.push(doc);
    // 1 本ごとに描画へ制御を返し、読み込み中の表示を止めないようにする
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return buildStore(docs, await loadQuickref(), new Date().toISOString());
}

async function loadQuickref(): Promise<QuickrefTable> {
  const source = await bundledQuickref();
  if (source === null) {
    return EMPTY_QUICKREF;
  }
  const read = await readQuickrefSource(source);
  if (!read.ok) {
    throw new Error(`クイック表を読めません: ${read.messages.join(" / ")}`);
  }
  return {
    sourceHash: source.hash,
    modChannel: read.file.modChannel ?? null,
    verifiedAt: read.file.verifiedAt,
    rows: toQuickrefRows(read.file),
  };
}
