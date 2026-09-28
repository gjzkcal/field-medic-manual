// お気に入り・履歴の対象（PrefTarget）の扱い。開く先の URL と、比べるためのキー。
import { docHref } from "@/features/library/link";
import { quickrefHref } from "@/features/quickref/link";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";

/** 種類の名前（アイコンの読み上げに使う） */
export const PREF_KIND_LABELS: Record<PrefTarget["kind"], string> = {
  section: "マニュアルの節",
  document: "マニュアル",
  flow: "トリアージ",
  quickref: "クイック表",
};

/** 開く先。メインでも小窓でも同じパスで開ける。 */
export function prefHref(target: PrefTarget): string {
  switch (target.kind) {
    case "section":
      return docHref(target.documentId, target.anchor);
    case "document":
      return docHref(target.documentId, null);
    case "flow":
      return `/triage/${encodeURIComponent(target.flowId)}`;
    case "quickref":
      return quickrefHref(target.rowId);
  }
}

/** 対象を比べたり React の key にしたりするための文字列。種類を前に付け、id が重なっても区別する。 */
export function prefKey(target: PrefTarget): string {
  switch (target.kind) {
    case "section":
      return `section:${target.documentId}#${target.anchor}`;
    case "document":
      return `document:${target.documentId}`;
    case "flow":
      return `flow:${target.flowId}`;
    case "quickref":
      return `quickref:${target.rowId}`;
  }
}

export function samePrefTarget(a: PrefTarget, b: PrefTarget): boolean {
  return prefKey(a) === prefKey(b);
}
