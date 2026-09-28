// content/quickref.yaml をアプリに同梱し、読む（dev-docs/reference/bundled-content.md §3）。
import { sha256HexOfText } from "@/features/content/hash";
import { fileName } from "@/features/content/path";
import { parseQuickref, type QuickrefParseResult } from "@/features/quickref/schema";

const QUICKREF_TEXTS = import.meta.glob<string>("/content/quickref.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** 同梱したクイック表のファイル。 */
export interface QuickrefSource {
  fileName: string;
  text: string;
  /** ファイルの中身の sha256。変わったときだけ DB の全行を置き換える */
  hash: string;
}

/** 同梱したクイック表。ファイルがなければ null。 */
export async function bundledQuickref(): Promise<QuickrefSource | null> {
  const [entry] = Object.entries(QUICKREF_TEXTS);
  if (entry === undefined) {
    return null;
  }
  const [path, text] = entry;
  return { fileName: fileName(path), text, hash: await sha256HexOfText(text) };
}

/** ファイルの中身を読んでクイック表にする。 */
export async function readQuickrefSource(
  source: Pick<QuickrefSource, "text">,
): Promise<QuickrefParseResult> {
  // BOM 付きで保存すると、エディタによっては先頭のキーが別の名前として読まれるため、決まり（UTF-8、BOM なし）を守らせる
  if (source.text.startsWith("\uFEFF")) {
    return { ok: false, messages: ["UTF-8（BOM なし）で保存してください"] };
  }
  let value: unknown;
  try {
    // 起動時の JS を小さくするため、YAML の読み取りは使うときに読み込む（00-overview.md §5）
    const { parse } = await import("yaml");
    value = parse(source.text);
  } catch (error: unknown) {
    return {
      ok: false,
      messages: [`読めません: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return parseQuickref(value);
}
