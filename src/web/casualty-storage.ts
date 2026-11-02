// Web 版の負傷者の記録（デスクトップ版は Rust の db/casualties.rs）。localStorage は同じ origin のほかのページからも
// 書けるので、読むたびに形と上限を確かめる。上限を変えるときは Rust の側も直す。
import type { Casualty } from "@/lib/bindings/Casualty";
import type { CasualtyEntry } from "@/lib/bindings/CasualtyEntry";
import type { CasualtyOp } from "@/lib/bindings/CasualtyOp";
import { z } from "@/lib/zod";
import { LOCAL_CASUALTIES_KEY } from "@/web/storage-keys";
import { WebAppError } from "@/web/web-error";

const MAX_CASUALTIES = 20;
const MAX_RECORDS_PER_CASUALTY = 100;
const MAX_NAME_CHARS = 40;
const MAX_NOTE_CHARS = 100;
const MAX_ID_LEN = 64;

/** Rust と同じく文字数で数える（`.max` は UTF-16 の単位で数える） */
function textOf(maxChars: number): z.ZodType<string> {
  return z
    .string()
    .refine(
      (value) => value.trim().length > 0 && Array.from(value).length <= maxChars,
      "長さが不正です",
    );
}

const id = z.string().min(1).max(MAX_ID_LEN);
const drug = z.enum([
  "epinephrine",
  "morphine",
  "metoprolol",
  "naloxone",
  "phenylephrine",
  "ammonium_carbonate",
]);
const site = z.enum(["left_arm", "right_arm", "left_leg", "right_leg"]);

const entrySchema: z.ZodType<CasualtyEntry> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("drug"), drug }),
  z.strictObject({ kind: z.literal("saline") }),
  z.strictObject({ kind: z.literal("tourniquet_on"), site }),
  z.strictObject({ kind: z.literal("tourniquet_off"), site }),
  z.strictObject({ kind: z.literal("note"), text: textOf(MAX_NOTE_CHARS) }),
]);

const opSchema: z.ZodType<CasualtyOp> = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add_casualty"), name: textOf(MAX_NAME_CHARS) }),
  z.strictObject({ op: z.literal("remove_casualty"), casualtyId: id }),
  z.strictObject({ op: z.literal("clear_all") }),
  z.strictObject({ op: z.literal("add_record"), casualtyId: id, entry: entrySchema }),
  z.strictObject({ op: z.literal("remove_record"), casualtyId: id, recordId: id }),
  z.strictObject({ op: z.literal("set_pain"), casualtyId: id, inPain: z.boolean() }),
]);

const storedSchema: z.ZodType<Casualty[]> = z
  .array(
    z.strictObject({
      id,
      name: textOf(MAX_NAME_CHARS),
      createdAtMs: z.number().int().nonnegative(),
      // 痛み・気胸を足す前に保存した記録にはないので、デスクトップ版の列と同じ既定（あり）にする
      inPain: z.boolean().default(true),
      records: z
        .array(
          z.strictObject({
            id,
            atMs: z.number().int().nonnegative(),
            entry: entrySchema,
          }),
        )
        .max(MAX_RECORDS_PER_CASUALTY),
    }),
  )
  .max(MAX_CASUALTIES);

/** 保存された値を読む。形が違えば、部分的に信じず空にする（古い版の値や、ほかのページが書いた値に備えるため）。 */
export function parseStoredCasualties(value: unknown): Casualty[] {
  const result = storedSchema.safeParse(value);
  return result.success ? result.data : [];
}

function invalid(message: string): WebAppError {
  return new WebAppError("invalid_input", message);
}

function requireCasualty(list: readonly Casualty[], casualtyId: string): Casualty {
  const casualty = list.find((c) => c.id === casualtyId);
  if (casualty === undefined) {
    throw new WebAppError("not_found", "負傷者が見つかりません");
  }
  return casualty;
}

/** 操作を確かめて適用した一覧を返す。Rust の `casualties::apply` と同じ結果にする。 */
export function applyOp(
  list: readonly Casualty[],
  value: unknown,
  nowMs: number,
  newId: () => string,
): Casualty[] {
  const parsed = opSchema.safeParse(value);
  if (!parsed.success) {
    throw invalid("記録の内容が不正です");
  }
  const op = parsed.data;
  switch (op.op) {
    case "add_casualty":
      if (list.length >= MAX_CASUALTIES) {
        throw invalid(`負傷者は ${String(MAX_CASUALTIES)} 人までです`);
      }
      return [
        ...list,
        { id: newId(), name: op.name.trim(), createdAtMs: nowMs, inPain: true, records: [] },
      ];
    case "remove_casualty":
      return list.filter((c) => c.id !== op.casualtyId);
    case "clear_all":
      return [];
    case "add_record": {
      const casualty = requireCasualty(list, op.casualtyId);
      if (casualty.records.length >= MAX_RECORDS_PER_CASUALTY) {
        throw invalid(`記録は 1 人 ${String(MAX_RECORDS_PER_CASUALTY)} 件までです`);
      }
      const records = [...casualty.records, { id: newId(), atMs: nowMs, entry: op.entry }];
      return list.map((c) => (c.id === casualty.id ? { ...c, records } : c));
    }
    case "remove_record":
      return list.map((c) =>
        c.id === op.casualtyId
          ? { ...c, records: c.records.filter((r) => r.id !== op.recordId) }
          : c,
      );
    case "set_pain": {
      const casualty = requireCasualty(list, op.casualtyId);
      return list.map((c) => (c.id === casualty.id ? { ...c, inPain: op.inPain } : c));
    }
  }
}

function defaultStorage(): Storage {
  // localStorage の参照そのものが例外を出すブラウザ設定があるので、関数にして try の中で触る
  return window.localStorage;
}

/** 読めないとき（プライベートブラウズで禁止されているなど）は空にする。 */
export function readCasualties(storage: () => Storage = defaultStorage): Casualty[] {
  try {
    const text = storage().getItem(LOCAL_CASUALTIES_KEY);
    return text === null ? [] : parseStoredCasualties(JSON.parse(text));
  } catch {
    return [];
  }
}

/** 別のタブが書いた分を消さないよう、書く直前に読み直して適用する。 */
export function applyAndSave(op: CasualtyOp, storage: () => Storage = defaultStorage): Casualty[] {
  const next = applyOp(readCasualties(storage), op, Date.now(), () => crypto.randomUUID());
  try {
    storage().setItem(LOCAL_CASUALTIES_KEY, JSON.stringify(next));
  } catch (error: unknown) {
    throw new WebAppError(
      "io",
      `ブラウザに保存できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return next;
}
