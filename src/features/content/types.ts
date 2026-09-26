// 同梱する原稿を DB に入れるときの型。仕様は dev-docs/reference/bundled-content.md §4。
// DocMeta / SourceType は Rust から生成した bindings を使う（手で同期しないため）。
import type { DocMeta } from "@/lib/bindings/DocMeta";
import type { SourceType } from "@/lib/bindings/SourceType";

/** アプリに同梱した原稿 1 ファイル。 */
export interface ManualSource {
  /** 例: hemorrhage.md */
  fileName: string;
  /** リポジトリのルートからのパス（例: /content/manuals/hemorrhage.md）。相対パスの画像を解決する基準 */
  path: string;
  text: string;
  /** 原稿と画像から計算した sha256。変わったときだけ DB に入れ直す */
  hash: string;
}

/** 画像を読む。パスは ManualSource.path と同じくリポジトリのルートから。テストではファイルから読む。 */
export type ReadImage = (path: string) => Promise<Uint8Array>;

export interface NormalizedSection {
  /** 0 = 導入部、1〜6 */
  level: number;
  title: string;
  /** ドキュメント内で一意 */
  anchor: string;
  /** DOMPurify 済み */
  html: string;
  plainText: string;
  tags: string[];
}

export interface NormalizedAsset {
  /** sha256（小文字 16 進） */
  id: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface NormalizedDoc {
  title: string;
  sourceType: SourceType;
  /** bundle://manuals/<ファイル名>。同じ値のドキュメントを置き換える */
  sourcePath: string;
  sourceHash: string;
  meta: DocMeta;
  sections: NormalizedSection[];
  assets: NormalizedAsset[];
}

export interface ConvertedManual {
  doc: NormalizedDoc;
  /** 原稿の書き間違いなど。変換は止めずに積む */
  warnings: string[];
}
