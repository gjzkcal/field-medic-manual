// 表の列のうち、設定の「使っている MOD」に合わない組み合わせの列を消す（原稿の表の直前の `<!-- columns: -->` で付けた条件）。
import { readModColumns } from "@/features/content/mod-marker";
import { meetsModConditions } from "@/features/settings/mod-conditions";
import type { ActiveMods } from "@/features/triage/runner";

// 「同左」のセルは左の列を消すと何を指すか分からなくなるので、消す前に左のセルの中身で置き換える
const SAME_AS_LEFT = /^[（(]?同左[）)]?$/;

export function hideModColumns(table: HTMLTableElement, active: ActiveMods): void {
  const columns = readModColumns(table.getAttribute("data-mod-columns") ?? "");
  if (columns === null) {
    return;
  }
  // 後ろの列から消すと、前の列の位置がずれない
  const hidden = columns
    .flatMap((conditions, index) => (meetsModConditions(conditions, active) ? [] : [index]))
    .reverse();
  if (hidden.length === 0) {
    return;
  }
  for (const row of Array.from(table.rows)) {
    fillSameAsLeft(row);
    for (const index of hidden) {
      row.cells[index]?.remove();
    }
  }
}

/** 左から順に見るので、「同左」が続いても一番左の中身になる */
function fillSameAsLeft(row: HTMLTableRowElement): void {
  const cells = Array.from(row.cells);
  for (let index = 1; index < cells.length; index += 1) {
    const cell = cells[index];
    const left = cells[index - 1];
    if (cell !== undefined && left !== undefined && SAME_AS_LEFT.test(cell.textContent.trim())) {
      cell.replaceChildren(...Array.from(left.childNodes, (node) => node.cloneNode(true)));
    }
  }
}
