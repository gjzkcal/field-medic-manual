import { useState } from "react";

/**
 * 画面を開いた時点の日時。描画のたびに `new Date()` を呼ぶと描画が純粋でなくなるため、最初の 1 回だけ取る。
 * 「古い内容」の判定は日単位なので、画面を開いている間に日付が変わっても次に開くときに直れば足りる。
 */
export function useNow(): Date {
  const [now] = useState(() => new Date());
  return now;
}
