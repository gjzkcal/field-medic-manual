// クイック表の重症度。原稿には言葉で書き、DB には 1〜4 で入れる（content-guide.md §8）。
// 色だけで伝えないよう、画面では色と言葉を並べて出す。

/** 1 = 軽度 … 4 = 致命的 の順 */
export const SEVERITY_NAMES = ["軽度", "中等度", "重度", "致命的"] as const;
export type SeverityName = (typeof SEVERITY_NAMES)[number];
export type Severity = 1 | 2 | 3 | 4;
export const SEVERITIES: readonly Severity[] = [1, 2, 3, 4];

export function severityOfName(name: SeverityName): Severity {
  switch (name) {
    case "軽度":
      return 1;
    case "中等度":
      return 2;
    case "重度":
      return 3;
    case "致命的":
      return 4;
  }
}

/** DB の値を重症度にする。範囲外は Rust の CHECK で入らないが、型を絞るために最も近い値に丸める */
export function toSeverity(value: number): Severity {
  if (value <= 1) {
    return 1;
  }
  if (value >= 4) {
    return 4;
  }
  return value < 2.5 ? 2 : 3;
}

export function severityName(severity: Severity): SeverityName {
  return SEVERITY_NAMES[severity - 1] ?? "致命的";
}

/** バッジ・カードの縁の色（1 = 緑、2 = 黄、3 = 橙、4 = 赤。Step 06 の資料） */
export const SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  1: "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  2: "border-yellow-500 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  3: "border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300",
  4: "border-red-500 bg-red-500/15 text-red-700 dark:text-red-300",
};

export const SEVERITY_BORDER_CLASSES: Record<Severity, string> = {
  1: "border-l-emerald-500",
  2: "border-l-yellow-500",
  3: "border-l-orange-500",
  4: "border-l-red-500",
};
