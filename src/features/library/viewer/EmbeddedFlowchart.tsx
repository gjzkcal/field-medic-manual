// 本文の `data-flowchart` から描くフローチャート。形の検査（zod）を含むので、本文からは遅延読み込みで使う
// （図の無い原稿を開くときに読まないため）。
import { useLayoutEffect, useMemo, type JSX } from "react";

import { readFlowchartPayload } from "@/features/content/flowchart";
import { ManualFlowchart } from "@/features/library/viewer/ManualFlowchart";

interface EmbeddedFlowchartProps {
  /** 図の置き場所。本文が、差し込む前に figure の先頭に作っておいた箱 */
  host: HTMLElement;
  /** `data-flowchart` の中身 */
  json: string;
}

export function EmbeddedFlowchart({ host, json }: EmbeddedFlowchartProps): JSX.Element | null {
  const payload = useMemo(() => readFlowchartPayload(json), [json]);

  // 描けないときは、図の置き場所を隠し、figure の中の文のリストをそのまま見せる
  // （figure に manual-flowchart が付いている間、文のリストは画面から隠れる。index.css）
  useLayoutEffect(() => {
    host.toggleAttribute("hidden", payload === null);
    host.parentElement?.classList.toggle("manual-flowchart", payload !== null);
  }, [host, payload]);

  return payload === null ? null : <ManualFlowchart payload={payload} />;
}
