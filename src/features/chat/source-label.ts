// AI が読んだ節・行・フローを、利用者に読める名前で出す。
// AI がツールに渡すのは `doc:pain.md#circulation-を入れている場合` のような内部の書式で、
// アンカーや id をそのまま出すと、何を読んだのかが利用者に伝わらない。
import { findDocByFile } from "@/features/content/link-target";
import { parseFlowLink } from "@/features/triage/links";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { QuickrefRow } from "@/lib/bindings/QuickrefRow";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";

export interface SourceLookups {
  outline: readonly DocOutline[];
  quickrefRows: readonly QuickrefRow[];
  flows: readonly TriageSummary[];
}

export type SourceKind = "doc" | "quickref" | "flow" | "other";

/** 名前を引くのに、どの一覧が要るか（要らない一覧を読まないため） */
export function sourceKind(source: string): SourceKind {
  const link = parseFlowLink(source);
  return link === null || link.kind === "external" ? "other" : link.kind;
}

/**
 * 「マニュアルの名前 › 見出し」「クイック表 › 症状」「フロー › 題名」。
 * 一覧に見つからないもの（読み込み中、AI が存在しない節を指した）は、渡された書式から分かる範囲で出す。
 */
export function sourceLabel(source: string, lookups: SourceLookups): string {
  const link = parseFlowLink(source);
  if (link === null) {
    return source;
  }
  switch (link.kind) {
    case "doc": {
      const doc = findDocByFile(lookups.outline, link.fileName);
      if (doc === undefined) {
        return link.anchor ?? link.fileName;
      }
      if (link.anchor === null) {
        return doc.title;
      }
      const heading = doc.headings.find((h) => h.anchor === link.anchor);
      return `${doc.title} › ${heading?.title ?? link.anchor}`;
    }
    case "quickref": {
      const row = lookups.quickrefRows.find((r) => r.id === link.rowId);
      return row === undefined ? `クイック表（${link.rowId}）` : `クイック表 › ${row.symptom}`;
    }
    case "flow": {
      const flow = lookups.flows.find((f) => f.id === link.flowId);
      return flow === undefined ? `フロー（${link.flowId}）` : `フロー › ${flow.title}`;
    }
    case "external":
      return source;
  }
}
