// end の outcome の色。現場で一目で分かるよう、色と文言の両方で示す。
// 答えのボタンには色を付けない。状態が重い側の答え（「出血している」の「はい」）を赤くすると、
// 消す操作と同じ「押すな」に読め、緑と青も答えの正解・不正解に読める。色は、状態そのものを表す結果だけに使う
import type { Outcome } from "@/features/triage/schema";

export const OUTCOME_LABELS: Record<Outcome, string> = {
  ok: "安定",
  warn: "要注意",
  critical: "危険",
};

export const OUTCOME_CLASSES: Record<Outcome, string> = {
  ok: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  critical: "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300",
};
