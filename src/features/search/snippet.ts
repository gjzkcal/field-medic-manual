// Rust の src-tauri/src/db/text.rs の MARK_START / MARK_END と同じ値にする。
// 強調を HTML タグで受け取ると、本文由来の文字列を innerHTML に入れることになるため、私用領域の文字で区切って受け取る
export const MARK_START = "\uE000";
export const MARK_END = "\uE001";

export interface SnippetPart {
  text: string;
  hit: boolean;
  /** スニペット内の開始位置。React の key に使う */
  start: number;
}

/** 検索結果のスニペットを、強調する部分としない部分に分ける。 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let hit = false;
  let text = "";
  let start = 0;
  let index = 0;
  for (const char of snippet) {
    if (char === MARK_START || char === MARK_END) {
      if (text !== "") {
        parts.push({ text, hit, start });
      }
      text = "";
      hit = char === MARK_START;
      start = index + char.length;
    } else {
      text += char;
    }
    index += char.length;
  }
  if (text !== "") {
    parts.push({ text, hit, start });
  }
  return parts;
}
