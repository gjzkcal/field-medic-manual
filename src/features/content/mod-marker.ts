// 原稿に書く MOD の表示条件の印。節は見出しの直後の `<!-- mods: … -->`（document.ts）、
// 表の列は表の直前の `<!-- columns: … -->` で書く。どちらも設定の「使っている MOD」に合うものだけをビューアが出す。
import type { ModConditions } from "@/features/settings/mod-conditions";
import { isSelectableMod, SELECTABLE_MODS } from "@/features/settings/mod-settings";
import type { ModTarget } from "@/lib/bindings/ModTarget";

const COLUMNS_COMMENT = /^\s*columns\s*[:：](.*)$/is;
/** 列に条件を付けないときの書き方 */
const NO_CONDITION = "-";

/** `circulation, !hitzones` を条件にする。! は「入れていないとき」。書き間違いは warnings に積んで捨てる */
export function parseModConditions(raw: string, where: string, warnings: string[]): ModConditions {
  const mods: ModTarget[] = [];
  const withoutMods: ModTarget[] = [];
  for (const token of raw.split(/[,、\s]+/).filter((t) => t !== "")) {
    // 日本語入力のまま書いた全角の ! も受ける
    const without = /^[!！]/.test(token);
    const name = token.replace(/^[!！]/, "").toLowerCase();
    // core と general は常に有効なので条件にならず、ここで不明として扱う
    if (!isSelectableMod(name)) {
      warnings.push(
        `mods の値が不明です: ${token}（${where}。${SELECTABLE_MODS.join(" / ")} のどれか。! を付けると入れていないとき）`,
      );
      continue;
    }
    const list = without ? withoutMods : mods;
    if (!list.includes(name)) {
      list.push(name);
    }
  }
  return { mods, withoutMods };
}

/**
 * 表の直前の `<!-- columns: - | circulation, breathing | !circulation -->` を読み、表に `data-mod-columns`（列ごとの条件の JSON）を付ける。
 * 列は `|` で区切り、条件のない列は `-` と書く。印は消す。書き間違いは警告にする（同梱の原稿は警告 0 を検査している）。
 */
export function markModColumns(body: HTMLElement, warnings: string[]): void {
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Comment && COLUMNS_COMMENT.test(node.data)) {
      comments.push(node);
    }
  }
  for (const comment of comments) {
    const raw = COLUMNS_COMMENT.exec(comment.data)?.[1] ?? "";
    const where = `列の印「${comment.data.trim()}」`;
    const table = tableAfter(comment);
    comment.remove();
    if (table === null) {
      warnings.push(`${where}: 印の次が表ではありません`);
      continue;
    }
    const columns = raw
      .split("|")
      .map((item) => item.trim())
      .map((item) =>
        item === NO_CONDITION ? { mods: [], withoutMods: [] } : parseModConditions(item, where, warnings),
      );
    const headerCells = table.rows[0]?.cells.length ?? 0;
    if (columns.length !== headerCells) {
      warnings.push(
        `${where}: 列の数（${String(columns.length)}）が表の列の数（${String(headerCells)}）と合いません`,
      );
      continue;
    }
    table.setAttribute("data-mod-columns", JSON.stringify(columns));
  }
}

/** 印の次の要素（空白だけのテキストは飛ばす）が表ならそれを返す */
function tableAfter(comment: Comment): HTMLTableElement | null {
  for (let next = comment.nextSibling; next !== null; next = next.nextSibling) {
    if (next instanceof HTMLTableElement) {
      return next;
    }
    if (next.nodeType !== Node.TEXT_NODE || (next.textContent ?? "").trim() !== "") {
      return null;
    }
  }
  return null;
}

/** `data-mod-columns` の値を読む。形が違えば null（表はそのまま全部の列を出す） */
export function readModColumns(value: string): ModConditions[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const items: unknown[] = parsed;
  const columns: ModConditions[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(item));
    const mods = modList(record["mods"]);
    const withoutMods = modList(record["withoutMods"]);
    if (mods === null || withoutMods === null) {
      return null;
    }
    columns.push({ mods, withoutMods });
  }
  return columns;
}

function modList(value: unknown): ModTarget[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: unknown[] = value;
  const mods = items.filter((m): m is ModTarget => typeof m === "string" && isSelectableMod(m));
  return mods.length === items.length ? mods : null;
}
