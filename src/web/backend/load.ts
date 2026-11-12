// 同梱した原稿・クイック表・トリアージのフローを変換して、Web 版の表を作る。本番はビルドのときに Node で（build-time.ts）、
// 開発サーバーとテストはブラウザ（jsdom）で、最初に使われたときに動く。
// デスクトップ版と同じ変換（Markdown → 無害化した HTML の節）を使うので、表示も検索もアプリと同じ原稿の内容になる。
import { bundledManuals, readBundledData, readBundledImage } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import type { NormalizedDoc, ReadImage } from "@/features/content/types";
import { bundledQuickref, readQuickrefSource } from "@/features/quickref/bundle";
import { toQuickrefRows } from "@/features/quickref/schema";
import { bundledFlows, flowSearchText, readFlowSource } from "@/features/triage/bundle";
import type { Flow } from "@/features/triage/schema";
import { validateFlows } from "@/features/triage/validate";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import { buildStore, type WebFlow, type WebStore } from "@/web/backend/store";

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
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  const now = new Date().toISOString();
  return buildStore(docs, await loadQuickref(), now, await loadFlows(now));
}

/**
 * デスクトップ版の起動時の同期（features/triage/sync.ts）は検証エラーのフローを飛ばして残りを入れるが、
 * Web 版は前回の内容を持たないので、1 本でもエラーがあればビルドを止める（壊れたフローを黙って欠いたまま公開しない）。
 */
async function loadFlows(updatedAt: string): Promise<WebFlow[]> {
  const read: { fileName: string; hash: string; flow: Flow }[] = [];
  for (const source of await bundledFlows()) {
    const result = await readFlowSource(source);
    if (!result.ok) {
      throw new Error(`フロー ${source.fileName} を読めません: ${result.messages.join(" / ")}`);
    }
    read.push({ fileName: source.fileName, hash: source.hash, flow: result.flow });
  }
  const issues = validateFlows(read.map((r) => r.flow));
  return read.map(({ fileName, hash, flow }, i): WebFlow => {
    const errors = (issues[i] ?? []).filter((issue) => issue.level === "error");
    if (errors.length > 0) {
      throw new Error(
        `フロー ${fileName} に誤りがあります: ${errors.map((e) => `${e.code}: ${e.message}`).join(" / ")}`,
      );
    }
    return {
      detail: {
        id: flow.id,
        title: flow.title,
        description: flow.description ?? null,
        modTargets: flow.modTarget ?? [],
        modChannel: flow.modChannel ?? null,
        verifiedAt: flow.verifiedAt ?? null,
        version: flow.version ?? 1,
        sourceHash: hash,
        updatedAt,
        // 実行画面は DB の json と同じく、この文字列を zod で読み直す
        json: JSON.stringify(flow),
      },
      order: flow.order ?? null,
      searchText: flowSearchText(flow),
    };
  });
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
