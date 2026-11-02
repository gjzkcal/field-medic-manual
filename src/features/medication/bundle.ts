// content/medication.yaml をアプリに同梱し、読む。
import { parseMedication, type MedicationFile } from "@/features/medication/schema";

// 負傷者の画面を開くまで読まない（起動時の JS を小さくするため）
const MEDICATION_TEXTS = import.meta.glob<string>("/content/medication.yaml", {
  query: "?raw",
  import: "default",
});

let cached: Promise<MedicationFile> | undefined;

async function read(): Promise<MedicationFile> {
  const load = MEDICATION_TEXTS["/content/medication.yaml"];
  if (load === undefined) {
    throw new Error("薬の数値のファイルが同梱されていません");
  }
  const [text, { parse }] = await Promise.all([load(), import("yaml")]);
  return parseMedication(parse(text));
}

/** 同梱した薬の数値。1 回だけ読む。失敗したら、次の呼び出しでやり直す */
export async function loadMedication(): Promise<MedicationFile> {
  cached ??= read();
  try {
    return await cached;
  } catch (error: unknown) {
    cached = undefined;
    throw error;
  }
}
