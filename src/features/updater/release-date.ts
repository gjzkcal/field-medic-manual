// updater が返す公開日は Rust の time の表記（`2026-09-30 12:00:00.0 +00:00:00`）で、Date では読めないことがある。
// 画面では JST の日時にそろえて出す。
const TIME_CRATE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?|Z)$/;

const JST = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function parse(date: string): Date | null {
  const match = TIME_CRATE.exec(date.trim());
  if (match === null) {
    const fallback = new Date(date);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  // 省いた部分（秒の端数・秒のオフセット・Z のときのオフセット）は 0 として扱う
  const [, y, mo, d, h, mi, s, sign, oh = "0", om = "0", os = "0"] = match;
  const offsetSeconds =
    (sign === "-" ? -1 : 1) * (Number(oh) * 3600 + Number(om) * 60 + Number(os));
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return new Date(utc - offsetSeconds * 1000);
}

/** 例: `2026/09/30 21:00 JST`。読めなければ null（日付を出さない） */
export function formatReleaseDate(date: string | null): string | null {
  if (date === null) {
    return null;
  }
  const parsed = parse(date);
  return parsed === null ? null : `${JST.format(parsed)} JST`;
}
