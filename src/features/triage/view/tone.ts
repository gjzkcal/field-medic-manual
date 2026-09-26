// 選択肢の tone と、end の outcome の色。現場で一目で分かるよう、色と文言の両方で示す。
import type { ChoiceTone, Outcome } from "@/features/triage/schema";

export const TONE_CLASSES: Record<ChoiceTone, string> = {
  yes: "border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20",
  no: "border-sky-500/60 bg-sky-500/10 hover:bg-sky-500/20 dark:border-sky-500/60 dark:bg-sky-500/10 dark:hover:bg-sky-500/20",
  neutral: "",
  danger:
    "border-red-500/70 bg-red-500/10 hover:bg-red-500/20 dark:border-red-500/70 dark:bg-red-500/10 dark:hover:bg-red-500/20",
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  ok: "安定",
  warn: "要注意",
  critical: "危険",
};

export const OUTCOME_CLASSES: Record<Outcome, string> = {
  ok: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critical: "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300",
};
