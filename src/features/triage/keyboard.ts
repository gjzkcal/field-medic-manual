// 実行画面のキー操作で、ほかの入力を邪魔しないための判定。

/** 文字を打つ場所（上部の検索欄など）。そこで押した数字や Backspace を横取りしないため。 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * ボタンやリンク。そこで押した Enter / Space はブラウザがその要素のクリックにするので、
 * ここでも処理すると 2 回進んでしまう。
 */
export function isActivatable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a[href], [role=button], [role=link], summary") !== null
  );
}

/** 修飾キー付きは、アプリ全体のショートカット（Ctrl+K など）に任せる。 */
export function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}
