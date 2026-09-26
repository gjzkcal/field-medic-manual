// content/flows/ のフローをアプリに同梱し、読む（dev-docs/reference/bundled-content.md §3）。
// import.meta.glob はビルド時に展開されるので、フローを足すだけでここを直さずに同梱される。
import { sha256HexOfText } from "@/features/content/hash";
import { fileName } from "@/features/content/path";
import { parseFlow, type Flow, type ParseResult } from "@/features/triage/schema";

const FLOW_TEXTS = import.meta.glob<string>(
  ["/content/flows/*.flow.yaml", "/content/flows/*.flow.json"],
  { query: "?raw", import: "default", eager: true },
);

/** 同梱したフローのファイル 1 つ。 */
export interface FlowSource {
  /** 例: casualty-first-contact.flow.yaml */
  fileName: string;
  text: string;
  /** ファイルの中身の sha256。変わったときだけ DB に入れ直す */
  hash: string;
}

const FLOW_FILE = /^(.+)\.flow\.(?:yaml|json)$/;

/** ファイル名が示すフローの id（`<id>.flow.yaml`）。形が違えば null。 */
export function flowIdOfFileName(name: string): string | null {
  return FLOW_FILE.exec(name)?.[1] ?? null;
}

/** 同梱したフローの一覧（ファイル名順）。 */
export async function bundledFlows(): Promise<FlowSource[]> {
  const sources = await Promise.all(
    Object.entries(FLOW_TEXTS).map(async ([path, text]) => ({
      fileName: fileName(path),
      text,
      hash: await sha256HexOfText(text),
    })),
  );
  return sources.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** ファイルの中身を読んでフローにする。YAML と JSON のどちらかを拡張子で決める。 */
export async function readFlowSource(
  source: Pick<FlowSource, "fileName" | "text">,
): Promise<ParseResult> {
  let value: unknown;
  try {
    if (source.fileName.endsWith(".json")) {
      value = JSON.parse(source.text);
    } else {
      // 起動時の JS を小さくするため、YAML の読み取りは使うときに読み込む（00-overview.md §5）
      const { parse } = await import("yaml");
      value = parse(source.text);
    }
  } catch (error: unknown) {
    return {
      ok: false,
      messages: [`読めません: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return parseFlow(value);
}

/** 検索用の文字列。説明を先頭に置くのは、タイトルだけに当たったときのスニペットに説明が出るようにするため。 */
export function flowSearchText(flow: Flow): string {
  const parts: string[] = [];
  if (flow.description !== undefined) {
    parts.push(flow.description);
  }
  for (const node of Object.values(flow.nodes)) {
    switch (node.type) {
      case "question":
        parts.push(node.text, ...node.choices.map((c) => c.label));
        break;
      case "action":
        parts.push(node.text, ...(node.items ?? []));
        if (node.ifMissing?.label !== undefined) {
          parts.push(node.ifMissing.label);
        }
        break;
      case "end":
        parts.push(node.text);
        break;
      case "subflow":
        break;
    }
    if (node.type !== "subflow" && node.help !== undefined) {
      parts.push(node.help);
    }
  }
  // 「はい」「いいえ」はどのフローにもあり、検索の手がかりにならないので重複をまとめる
  return [...new Set(parts)].join("\n");
}
