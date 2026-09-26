// フローの関連リンク（action / end の links）の解釈。書式は dev-docs/reference/triage-format.md §2。
import { decodeAnchor } from "@/features/library/link";

export type FlowLink =
  | { kind: "doc"; fileName: string; anchor: string | null }
  | { kind: "flow"; flowId: string }
  | { kind: "quickref"; rowId: string }
  | { kind: "external"; url: string };

// doc: はマニュアルの本文の内部リンクと同じく content/manuals/ 直下の md だけを指す（DB の UUID は作者に分からないため）
const DOC_LINK = /^doc:([a-z0-9-]+\.md)(?:#(.+))?$/;
const FLOW_LINK = /^flow:([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const QUICKREF_LINK = /^quickref:(\S+)$/;
const EXTERNAL_LINK = /^https:\/\/\S+$/;

/** 上の 4 つの書式をまとめた正規表現の文字列。JSON Schema の pattern にしてエディタでも書式を確かめる */
export const FLOW_LINK_PATTERN = `^(?:${[DOC_LINK, FLOW_LINK, QUICKREF_LINK, EXTERNAL_LINK]
  .map((r) => r.source.slice(1, -1))
  .join("|")})$`;

/** 書式に合わなければ null。 */
export function parseFlowLink(text: string): FlowLink | null {
  const doc = DOC_LINK.exec(text);
  if (doc?.[1] !== undefined) {
    const anchor = doc[2] === undefined ? "" : decodeAnchor(doc[2]);
    return { kind: "doc", fileName: doc[1], anchor: anchor === "" ? null : anchor };
  }
  const flow = FLOW_LINK.exec(text);
  if (flow?.[1] !== undefined) {
    return { kind: "flow", flowId: flow[1] };
  }
  const quickref = QUICKREF_LINK.exec(text);
  if (quickref?.[1] !== undefined) {
    return { kind: "quickref", rowId: quickref[1] };
  }
  if (EXTERNAL_LINK.test(text)) {
    return { kind: "external", url: text };
  }
  return null;
}
