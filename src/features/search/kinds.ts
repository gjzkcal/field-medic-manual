// 検索結果の種類ごとの表示と遷移の登録表。
// SearchHit["kind"] を添字にしたマップ型なので、Rust 側で種類が増えたのに登録を忘れるとコンパイルエラーになる。
import { FileTextIcon, TableIcon, WorkflowIcon, type LucideIcon } from "lucide-react";

import { docHref } from "@/features/library/link";
import { conditionLabel } from "@/features/quickref/conditions";
import { quickrefHref } from "@/features/quickref/link";
import { severityName, toSeverity } from "@/features/quickref/severity";
import type { PrefTarget } from "@/lib/bindings/PrefTarget";
import type { SearchHit } from "@/lib/bindings/SearchHit";

type HitKind = SearchHit["kind"];
type HitOf<K extends HitKind> = Extract<SearchHit, { kind: K }>;

export interface SearchKind<H> {
  /** 種類の名前（アイコンの読み上げに使う） */
  label: string;
  icon: LucideIcon;
  /** 見出しの横に小さく出す、どこにあるかの説明 */
  context: (hit: H) => string;
  /** 見出しに添える印（同義語でのヒットなど）。なければ null */
  badge: (hit: H) => string | null;
  /** 開く先。パレットはルーターを持たないので、置き場所がこの文字列で遷移する */
  href: (hit: H) => string;
  /** お気に入り（Ctrl+Enter）で入れる対象 */
  favoriteTarget: (hit: H) => PrefTarget;
}

const SEARCH_KINDS: { [K in HitKind]: SearchKind<HitOf<K>> } = {
  section: {
    label: "マニュアル",
    icon: FileTextIcon,
    context: (hit) => hit.documentTitle,
    badge: (hit) => (hit.synonymOnly ? "同義語" : null),
    href: (hit) => docHref(hit.documentId, hit.anchor, hit.matchedTerms),
    favoriteTarget: (hit) => ({
      kind: "section",
      documentId: hit.documentId,
      anchor: hit.anchor,
    }),
  },
  flow: {
    label: "トリアージ",
    icon: WorkflowIcon,
    context: () => "トリアージ",
    badge: (hit) => (hit.synonymOnly ? "同義語" : null),
    href: (hit) => `/triage/${encodeURIComponent(hit.id)}`,
    favoriteTarget: (hit) => ({ kind: "flow", flowId: hit.id }),
  },
  quickref: {
    label: "クイック表",
    icon: TableIcon,
    context: (hit) => `${severityName(toSeverity(hit.severity))} · ${hit.category}`,
    // 検索は設定の「使っている MOD」で絞らないので、条件付きの行はそれを示す（同義語の印より優先）
    badge: (hit) => conditionLabel(hit) ?? (hit.synonymOnly ? "同義語" : null),
    href: (hit) => quickrefHref(hit.id),
    favoriteTarget: (hit) => ({ kind: "quickref", rowId: hit.id }),
  },
};

/**
 * 種類の定義を引く。種類が増えても `searchKind(hit.kind).href(hit)` の形で呼べるよう、
 * 添字を型引数にしている（和集合の hit をそのまま渡せる）。
 */
export function searchKind<K extends HitKind>(kind: K): SearchKind<HitOf<K>> {
  return SEARCH_KINDS[kind];
}

/** cmdk の項目の値。種類が違えば id が重なりうるので種類を前に付ける。 */
export function hitKey(hit: SearchHit): string {
  return `${hit.kind}:${String(hit.id)}`;
}
