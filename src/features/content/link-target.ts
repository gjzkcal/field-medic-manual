// 原稿の書式のリンク（`doc:` / `flow:` / `quickref:`）を、アプリの中の行き先にする。
// フローの関連リンクと、AI チャットの出典の両方で使う（解き方を 1 か所にまとめ、ずれを防ぐため）。
import { manualSourcePath } from "@/features/content/path";
import { docHref } from "@/features/library/link";
import { quickrefHref } from "@/features/quickref/link";
import type { FlowLink } from "@/features/triage/links";
import type { DocOutline } from "@/lib/bindings/DocOutline";

/** 原稿のファイル名（`hemorrhage.md`）から文書を探す。 */
export function findDocByFile(
  outline: readonly DocOutline[],
  fileName: string,
): DocOutline | undefined {
  return outline.find((d) => d.sourcePath === manualSourcePath(fileName));
}

/**
 * アプリの中の行き先（ルーターに渡すパス）。外部のリンクと、文書が見つからない `doc:` は null。
 */
export function internalHref(link: FlowLink, outline: readonly DocOutline[]): string | null {
  switch (link.kind) {
    case "doc": {
      const doc = findDocByFile(outline, link.fileName);
      return doc === undefined ? null : docHref(doc.id, link.anchor);
    }
    case "flow":
      return `/triage/${encodeURIComponent(link.flowId)}`;
    case "quickref":
      return quickrefHref(link.rowId);
    case "external":
      return null;
  }
}
