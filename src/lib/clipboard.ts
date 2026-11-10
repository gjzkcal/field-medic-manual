/**
 * 文字列をクリップボードに書く。デスクトップ版（メイン・小窓）と Web 版で同じ API を使う。
 * 小窓の閲覧モード（WS_EX_NOACTIVATE）でも、押したときに WebView の中の文書はフォーカスを得るので書ける
 * （前面のゲームのフォーカスは移らない）。Tauri のクリップボードのプラグインと権限は足していない。
 */
export async function copyText(text: string): Promise<void> {
  // http で LAN から開いた Web 版は secure context にならず、navigator.clipboard が無い
  if (!window.isSecureContext) {
    throw new Error("この接続ではクリップボードを使えません（https で開いてください）");
  }
  await navigator.clipboard.writeText(text);
}
