// AI の記録の提案を、承認のカードに出す文にする。画面と分けて確かめられるよう、純関数にする。
import { NEW_CASUALTY, proposedEntry } from "@/features/casualties/casualty-store";
import { entryLabel, formatClock } from "@/features/casualties/labels";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { ProposedOp } from "@/lib/bindings/ProposedOp";

export interface OpView {
  text: string;
  /** 記録や負傷者を消す操作（取り消せないので目立たせる） */
  destructive: boolean;
  /** 指している負傷者・記録が見つからない（承認しても記録できない） */
  missing: boolean;
}

/** 提案の操作を、利用者が読める 1 行ずつにする。負傷者は id ではなく名前で示す。 */
export function describeOps(ops: readonly ProposedOp[], casualties: readonly Casualty[]): OpView[] {
  let created: string | null = null;
  const find = (id: string): Casualty | undefined => casualties.find((c) => c.id === id);
  const who = (id: string): { name: string; missing: boolean } => {
    if (id === NEW_CASUALTY) {
      return { name: `新しい負傷者「${created ?? ""}」`, missing: created === null };
    }
    const casualty = find(id);
    return casualty === undefined
      ? { name: "（見つからない負傷者）", missing: true }
      : { name: `「${casualty.name}」`, missing: false };
  };
  return ops.map((op) => {
    switch (op.action) {
      case "add_casualty": {
        created = op.name.trim() === "" ? "名前は自動" : op.name.trim();
        return { text: `負傷者「${created}」を追加`, destructive: false, missing: false };
      }
      case "remove_casualty": {
        const target = who(op.casualty);
        return {
          text: `負傷者${target.name}を削除（記録もすべて消える）`,
          destructive: true,
          missing: target.missing,
        };
      }
      case "clear_all":
        return { text: "すべての負傷者と記録を消す", destructive: true, missing: false };
      case "give_drug":
      case "give_saline":
      case "tourniquet_on":
      case "tourniquet_off":
      case "add_note": {
        const target = who(op.casualty);
        return {
          text: `${target.name}に記録: ${entryLabel(proposedEntry(op))}`,
          destructive: false,
          missing: target.missing,
        };
      }
      case "remove_record": {
        const target = who(op.casualty);
        const record = find(op.casualty)?.records.find((r) => r.id === op.record);
        return {
          text:
            record === undefined
              ? `${target.name}の記録を消す（見つからない記録）`
              : `${target.name}の記録を消す: ${formatClock(record.atMs)} ${entryLabel(record.entry)}`,
          destructive: true,
          missing: target.missing || record === undefined,
        };
      }
      case "set_pain": {
        const target = who(op.casualty);
        return {
          text: `${target.name}の痛み・気胸を「${op.pain ? "あり" : "なし"}」にする`,
          destructive: false,
          missing: target.missing,
        };
      }
    }
  });
}
