// 会話のキャッシュの保温。索引を含む接頭辞のキャッシュは最後の要求から 5 分で消え、次の質問で書き直すと
// 読む場合の何倍も費用がかかる。パネルを開いている間は、期限の前に出力なしの要求を送って期限を延ばす。

/** 期限（5 分）より前に送る。前の要求の生成に 1 分かかっていても間に合う間隔 */
export const KEEP_ALIVE_INTERVAL_MS = 4 * 60_000;
/** 最後の回答からこれだけ過ぎたら止める（読み続ける費用が、次の質問で書き直す費用を超えないように） */
export const KEEP_ALIVE_WINDOW_MS = 20 * 60_000;

/**
 * 次の保温までの待ち時間。送らないなら null。
 *
 * @param nowMs 今
 * @param lastRequestMs 最後に API へ送った時刻（保温の要求を含む）。会話がなければ null
 * @param lastTurnEndMs 最後の回答が終わった時刻
 */
export function keepAliveDelayMs(
  nowMs: number,
  lastRequestMs: number | null,
  lastTurnEndMs: number | null,
): number | null {
  if (lastRequestMs === null || lastTurnEndMs === null) {
    return null;
  }
  const due = lastRequestMs + KEEP_ALIVE_INTERVAL_MS;
  // 予定の時刻でも今の時刻でも、回答から 20 分を過ぎていたら送らない（パネルを閉じて長く置いた後に開いたとき、
  // 期限切れのキャッシュを書き直す有料の要求を出さないため）
  const stop = lastTurnEndMs + KEEP_ALIVE_WINDOW_MS;
  if (due > stop || nowMs > stop) {
    return null;
  }
  return Math.max(0, due - nowMs);
}
