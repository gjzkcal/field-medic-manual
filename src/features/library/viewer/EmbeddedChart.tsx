// 本文の `data-chart` から描くグラフ。形の検査（zod）と Recharts を含むので、本文からは遅延読み込みで使う
// （グラフの無い原稿を開くときに読まないため）。
import { useLayoutEffect, useMemo, type JSX } from "react";

import { readChartPayload } from "@/features/content/chart";
import { ManualChart } from "@/features/library/viewer/ManualChart";

interface EmbeddedChartProps {
  /** グラフの置き場所。本文が、差し込む前に作っておいた figure */
  host: HTMLElement;
  /** `data-chart` の中身 */
  json: string;
  /** 表の直前に描くグラフか（表なしのグラフでなければ true） */
  withTable: boolean;
}

export function EmbeddedChart({ host, json, withTable }: EmbeddedChartProps): JSX.Element | null {
  const payload = useMemo(() => {
    const read = readChartPayload(json);
    return read !== null && read.data.points.length >= 2 ? read : null;
  }, [json]);

  // 描けないときは、置き場所の figure が空の余白として残らないように隠す
  useLayoutEffect(() => {
    host.toggleAttribute("hidden", payload === null);
  }, [host, payload]);

  return payload === null ? null : (
    <ManualChart spec={payload.spec} data={payload.data} withTable={withTable} />
  );
}
