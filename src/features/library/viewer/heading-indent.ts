// 見出しのレベルに応じた字下げ。ツリーと目次で揃える。Tailwind はクラス名を静的に拾うので、計算せず表で持つ
const HEADING_INDENT: Partial<Record<number, string>> = { 1: "pl-2", 2: "pl-5", 3: "pl-8" };

export function headingIndent(level: number): string {
  return HEADING_INDENT[level] ?? "pl-8";
}
