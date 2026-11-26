// キーの案内（数字・Backspace・Esc など）を出してよいかを、置き場所から部品へ渡す。
// 小窓は、ゲームのフォーカスを奪わない表示（閲覧モード）の間、キーが前面のアプリへ届く。
// その間に案内を出すと、案内どおりに押したキーがゲームの操作になる。
import { createContext, use } from "react";

export interface KeyInput {
  /** キーがこのウィンドウに届くか */
  receiving: boolean;
  /** キーが届くようにする操作。その手段がない置き場所では null */
  activate: (() => void) | null;
}

// メインと Web 版は、どこかを押せばウィンドウにフォーカスが移るので、常に届く扱いにする。
// フォーカスに合わせて案内を出し入れすると、押すたびにボタンの幅が変わってしまう
const ALWAYS_RECEIVING: KeyInput = { receiving: true, activate: null };

export const KeyInputContext = createContext<KeyInput>(ALWAYS_RECEIVING);

export function useKeyInput(): KeyInput {
  return use(KeyInputContext);
}
