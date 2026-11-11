// 負傷者の記録。本体はデスクトップ版は SQLite、Web 版は localStorage に置き、ここには画面に出す写しを持つ。
import { create } from "zustand";

import { nextCasualtyName } from "@/features/casualties/casualty-view";
import { loadModSettings } from "@/features/settings/mod-settings";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { CasualtyEntry } from "@/lib/bindings/CasualtyEntry";
import type { CasualtyOp } from "@/lib/bindings/CasualtyOp";
import type { ProposedOp } from "@/lib/bindings/ProposedOp";
import {
  casualtyApply,
  casualtyList,
  errorMessage,
  onCasualtiesChanged,
  onSettingsChanged,
} from "@/lib/tauri";

const MODS_SETTINGS_KEY = "mods";
/** AI の提案の中で、同じ提案で作った負傷者を指す（Rust の `NEW_CASUALTY` と同じ） */
export const NEW_CASUALTY = "new";

interface CasualtyState {
  casualties: Casualty[];
  loaded: boolean;
  error: string | null;
}

export const useCasualties = create<CasualtyState>()(() => ({
  casualties: [],
  loaded: false,
  error: null,
}));

// 操作と読み直しは順に 1 つずつ行う。応答の順が入れ替わると、古い一覧で新しい記録が画面から消えるため
let queue: Promise<unknown> = Promise.resolve();

function enqueue(task: () => Promise<Casualty[]>): Promise<void> {
  const run = queue.then(task).then(
    (casualties) => {
      useCasualties.setState({ casualties, loaded: true, error: null });
    },
    (error: unknown) => {
      useCasualties.setState({ loaded: true, error: errorMessage(error) });
    },
  );
  queue = run;
  return run;
}

/**
 * 画面を開いたときと、もう一方のウィンドウが書いたときに読み直す。起動時に読まないのは、
 * Web 版の読み込みが検査のライブラリを連れてくるので、マニュアルを読むだけの人に待たせないため。
 */
export function loadCasualties(): Promise<void> {
  return enqueue(() => casualtyList());
}

/**
 * AI が提案して利用者が承認した操作を、上から順に記録する。途中で失敗したら、そこで止めて理由を返す
 * （それまでの操作は記録済み。どこまで記録できたかは AI に読み直させる）。
 * 提案の中で作った負傷者は `"new"` で指されるので、作った直後の id に置き換える。
 */
export async function applyProposedOps(
  ops: readonly ProposedOp[],
): Promise<{ applied: number; error: string | null }> {
  const result: { applied: number; error: string | null } = { applied: 0, error: null };
  await enqueue(async () => {
    let list = await casualtyList();
    let created: string | null = null;
    for (const op of ops) {
      try {
        list = await casualtyApply(toCasualtyOp(op, created, list));
      } catch (error: unknown) {
        result.error = errorMessage(error);
        break;
      }
      if (op.action === "add_casualty") {
        // 足した負傷者は一覧の末尾に入る
        created = list.at(-1)?.id ?? null;
      }
      result.applied += 1;
    }
    return list;
  });
  return result;
}

/** 提案の操作を、記録の操作の形にする。 */
export function toCasualtyOp(
  op: ProposedOp,
  created: string | null,
  current: readonly Casualty[],
): CasualtyOp {
  const id = (casualty: string): string =>
    casualty === NEW_CASUALTY ? (created ?? casualty) : casualty;
  switch (op.action) {
    case "add_casualty":
      return {
        op: "add_casualty",
        name: op.name.trim() === "" ? nextCasualtyName(current.map((c) => c.name)) : op.name,
      };
    case "remove_casualty":
      return { op: "remove_casualty", casualtyId: id(op.casualty) };
    case "clear_all":
      return { op: "clear_all" };
    case "give_drug":
    case "give_saline":
    case "tourniquet_on":
    case "tourniquet_off":
    case "add_note":
      return { op: "add_record", casualtyId: id(op.casualty), entry: proposedEntry(op) };
    case "remove_record":
      return { op: "remove_record", casualtyId: id(op.casualty), recordId: op.record };
    case "set_pain":
      return { op: "set_pain", casualtyId: id(op.casualty), inPain: op.pain };
  }
}

/** 記録を足す提案の操作。AI 向けには、記録の種類を操作に平らにしてある（Rust の ProposedOp の注記）。 */
export type RecordProposal = Extract<
  ProposedOp,
  { action: "give_drug" | "give_saline" | "tourniquet_on" | "tourniquet_off" | "add_note" }
>;

/** 記録を足す提案の、記録の中身。 */
export function proposedEntry(op: RecordProposal): CasualtyEntry {
  switch (op.action) {
    case "give_drug":
      return { kind: "drug", drug: op.drug };
    case "give_saline":
      return { kind: "saline" };
    case "tourniquet_on":
      return { kind: "tourniquet_on", site: op.site };
    case "tourniquet_off":
      return { kind: "tourniquet_off", site: op.site };
    case "add_note":
      return { kind: "note", text: op.text };
  }
}

/** 記録を書く。失敗は `error` に入り、画面に出す。 */
export function applyCasualtyOp(op: CasualtyOp): Promise<void> {
  return enqueue(() => casualtyApply(op));
}

/**
 * 起動時に 1 回呼ぶ。片方のウィンドウで書いたらもう片方にすぐ出す。
 * 使っている MOD も、カードの出し分けが古いまま残らないよう一緒に追う。
 */
export function startCasualtySync(): void {
  void onCasualtiesChanged(() => {
    void loadCasualties();
  }).catch(() => {
    // 受け取れなくても、次に自分で書いたときに全体がそろう
  });
  void onSettingsChanged((key) => {
    if (key === MODS_SETTINGS_KEY) {
      void loadModSettings();
    }
  }).catch(() => {
    // 受け取れなくても、小窓を出し直せば読み直す
  });
}
