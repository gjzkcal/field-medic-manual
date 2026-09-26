// ホットキーの設定欄で押されたキーを、Rust（global-hotkey）が解釈できる組み合わせの文字列にする。
// Rust の window/hotkey.rs の normalize と同じ並び（Ctrl+Alt+Shift+Super+キー）にそろえる。

export type RecordResult =
  | { kind: "ok"; accelerator: string }
  /** 修飾キーだけを押している途中 */
  | { kind: "pending" }
  | { kind: "invalid"; reason: string };

/** KeyboardEvent のうち、判定に使う部分（テストで作りやすいように） */
export interface KeyInput {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

// global-hotkey が解釈できるキーのうち、ホットキーに向くもの。Esc は記録の取り消しに使うので入れない
const NAMED_CODES = new Set([
  "Backquote",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "Comma",
  "Equal",
  "Minus",
  "Period",
  "Quote",
  "Semicolon",
  "Slash",
  "Space",
  "Enter",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Pause",
]);

/** event.code から Rust に渡すキーの名前。配列（日本語 / 英語）に左右されないよう、文字ではなく位置で決める */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) {
    return letter;
  }
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) {
    return digit;
  }
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }
  if (/^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)$/.test(code)) {
    return code;
  }
  return NAMED_CODES.has(code) ? code : null;
}

export function acceleratorFromKey(input: KeyInput): RecordResult {
  if (MODIFIER_CODES.has(input.code)) {
    return { kind: "pending" };
  }
  const key = keyName(input.code);
  if (key === null) {
    return { kind: "invalid", reason: "このキーはホットキーに使えません" };
  }
  if (!input.ctrlKey && !input.altKey && !input.metaKey) {
    return {
      kind: "invalid",
      reason:
        "Ctrl・Alt・Win のどれかと一緒に押してください（ゲームや文字入力のキーを奪わないため）",
    };
  }
  const parts = [
    input.ctrlKey ? "Ctrl" : null,
    input.altKey ? "Alt" : null,
    input.shiftKey ? "Shift" : null,
    input.metaKey ? "Super" : null,
    key,
  ].filter((part) => part !== null);
  return { kind: "ok", accelerator: parts.join("+") };
}

/** 画面に出す形。Windows では Super キーを Win と呼ぶ。 */
export function displayAccelerator(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => (part === "Super" ? "Win" : part))
    .join(" + ");
}
