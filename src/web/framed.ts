// ほかのページの iframe の中で開かれたかの判定。枠の中ではアプリの代わりに FramedNotice を出す。
// GitHub Pages ではレスポンスヘッダ（X-Frame-Options や CSP の frame-ancestors）を付けられず、meta の CSP では frame-ancestors が効かない。
// 見えないように重ねたこのサイトを押させる（クリックジャッキング）余地をなくすため、枠の中では本文も操作も出さない
export function isFramed(win: { readonly top: unknown; readonly self: unknown } = window): boolean {
  try {
    // 親の中身は別の origin だと読めないが、WindowProxy どうしは比べられる
    return win.top !== win.self;
  } catch {
    // 比べられないときは枠の中とみなす（出さない側に倒す）
    return true;
  }
}
