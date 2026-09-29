// CHANGELOG は Keep a Changelog に従い、変更の種類を仕様どおり英語の見出し（`### Added` など）で書く。
// 更新のダイアログは Markdown をテキストのまま出すので、見出しだけ日本語にして読みやすくする。
const KIND_LABELS = new Map([
  ["Added", "追加"],
  ["Changed", "変更"],
  ["Deprecated", "廃止予定"],
  ["Removed", "削除"],
  ["Fixed", "修正"],
  ["Security", "セキュリティ"],
]);

const KIND_HEADING = /^###\s+(\S+)\s*$/;

/** 変更点の種類の見出しを【追加】のような日本語にする。知らない見出しや本文はそのまま残す。 */
export function formatReleaseNotes(notes: string): string {
  const out: string[] = [];
  let afterHeading = false;
  for (const line of notes.split(/\r?\n/)) {
    const kind = KIND_HEADING.exec(line)?.[1];
    const label = kind === undefined ? undefined : KIND_LABELS.get(kind);
    if (label !== undefined) {
      out.push(`【${label}】`);
      afterHeading = true;
      continue;
    }
    // CHANGELOG は見出しの下に空行を置くが、テキストで出すと間延びするので詰める
    if (afterHeading && line.trim() === "") {
      continue;
    }
    afterHeading = false;
    out.push(line);
  }
  return out.join("\n");
}
