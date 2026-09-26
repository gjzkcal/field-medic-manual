// 「古い内容」の判定。Dev 版は仕様がよく変わるので、確認から時間が経った原稿を画面で警告する（00-overview.md §7）。

export const STALE_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `now` の JST での日付（YYYY-MM-DD）。確認日は日付だけで書くので、日付どうしで比べるため。 */
export function todayJst(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 確認日から今日（JST）までの日数。日付として読めなければ null。 */
export function daysSinceVerified(verifiedAt: string, now: Date): number | null {
  const verified = Date.parse(`${verifiedAt}T00:00:00Z`);
  if (Number.isNaN(verified)) {
    return null;
  }
  const today = Date.parse(`${todayJst(now)}T00:00:00Z`);
  return Math.round((today - verified) / DAY_MS);
}

/** 確認日から 90 日を超えたか、確認日が書かれていなければ true（確認していない内容も同じく注意が要るため）。 */
export function isStale(verifiedAt: string | null, now: Date): boolean {
  if (verifiedAt === null) {
    return true;
  }
  const days = daysSinceVerified(verifiedAt, now);
  return days === null || days > STALE_AFTER_DAYS;
}
