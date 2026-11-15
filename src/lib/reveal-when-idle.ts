// content-visibility: auto でレイアウトと描画を後回しにした要素を、最初の表示の後、手の空いたときに 1 つずつ本物の描画に切り替える。
// 後回しにしたままにしないのは、画面の外の要素が仮の高さの箱のままだと、中身が箱からはみ出して隣と重なった位置になり、
// 画面の外まで調べる検査（Lighthouse の押せる大きさの監査）が落ち、スクロールのたびに高さも変わるため。
// 1 回に 1 つだけ切り替えるので、開いた直後に全部を一度に並べて固まることはない

const FALLBACK_DELAY_MS = 50;

/** 手の空いたときに呼ぶ。requestIdleCallback の無いブラウザ（Safari）は、少し待ってから呼ぶ */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run);
    return () => {
      cancelIdleCallback(handle);
    };
  }
  const timer = setTimeout(run, FALLBACK_DELAY_MS);
  return () => {
    clearTimeout(timer);
  };
}

/**
 * 渡した順に、まだ切り替えていない要素を 1 つずつ切り替える。返す関数で止める（画面を離れるとき）。
 * 何度呼んでもよい（切り替え済みの要素は飛ばす）
 */
export function revealWhenIdle(elements: readonly HTMLElement[]): () => void {
  const pending = elements.filter((el) => el.style.contentVisibility !== "visible");
  let cancel: (() => void) | undefined;
  const step = (): void => {
    const next = pending.shift();
    if (next === undefined) {
      cancel = undefined;
      return;
    }
    next.style.contentVisibility = "visible";
    cancel = whenIdle(step);
  };
  cancel = whenIdle(step);
  return () => {
    cancel?.();
  };
}
