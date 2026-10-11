// Web 版で、変換した原稿とクイック表をメモリに持つ。
// デスクトップ版は Rust が SQLite に入れて返す形（DocSummary・DocDetail・DocOutline など）を、同じ規則でここで作る
// （src-tauri/src/db/docs.rs の validate・insert_sections・list・outline・get、dict.rs の tag_list）。
import { fileName, fileStem } from "@/features/content/path";
import type { NormalizedAsset, NormalizedDoc } from "@/features/content/types";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocMeta } from "@/lib/bindings/DocMeta";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import type { Section } from "@/lib/bindings/Section";
import type { TagCount } from "@/lib/bindings/TagCount";
import {
  asciiLower,
  compareBinary,
  compareNoCase,
  firstNonZero,
  normalizeTags,
  stripMarks,
} from "@/web/backend/text";

/** 見出しツリーに出す深さ（デスクトップ版の OUTLINE_MAX_LEVEL と同じ） */
const OUTLINE_MAX_LEVEL = 3;

export interface WebStore {
  /** 一覧の順（order、タイトルの順） */
  docs: readonly DocDetail[];
  quickref: QuickrefTable;
  assets: ReadonlyMap<string, NormalizedAsset>;
}

/**
 * 変換した原稿からメモリの表を作る。
 * 文書の id はファイル名（拡張子なし）にする。デスクトップ版は DB が UUID を振るが、Web 版は URL（/doc/<id>）を共有されるので、
 * 原稿を直しても変わらない名前にする。
 */
export function buildStore(
  docs: readonly NormalizedDoc[],
  quickref: QuickrefTable,
  now: string,
): WebStore {
  const tagNames = new TagNames();
  const assets = new Map<string, NormalizedAsset>();
  const ids = new Set<string>();
  let nextSectionId = 1;
  // 節の id は文書をまたいで一意にする（検索結果の key が section:<id> のため）。同期の順（ファイル名順）で振る
  const sorted = [...docs].sort((a, b) => compareBinary(a.sourcePath, b.sourcePath));
  const details = sorted.map((doc): DocDetail => {
    const id = fileStem(fileName(doc.sourcePath));
    if (ids.has(id)) {
      throw new Error(`同じ名前の原稿が 2 つあります: ${id}`);
    }
    ids.add(id);
    for (const asset of doc.assets) {
      assets.set(asset.id, asset);
    }
    // デスクトップ版と同じく、文書のタグを節のタグより先に登録する（表記をそろえる順が変わらないように）
    const meta = normalizeMeta(doc.meta, tagNames);
    const sections = toSections(doc, () => nextSectionId++, tagNames);
    return {
      id,
      title: stripMarks(doc.title.trim()),
      sourceType: doc.sourceType,
      sourcePath: doc.sourcePath,
      sourceHash: doc.sourceHash,
      meta,
      sectionCount: sections.length,
      createdAt: now,
      updatedAt: now,
      originalAssetId: null,
      assets: doc.assets
        .map((a) => ({ id: a.id, mime: a.mime, fileName: a.fileName, size: a.bytes.byteLength }))
        .sort((a, b) =>
          firstNonZero(compareBinary(a.fileName, b.fileName), compareBinary(a.id, b.id)),
        ),
      sections,
    };
  });
  return { docs: details.sort(compareListOrder), quickref, assets };
}

export function listDocs(store: WebStore): DocSummary[] {
  return store.docs.map(toSummary);
}

export function findDoc(store: WebStore, id: string): DocDetail | undefined {
  return store.docs.find((d) => d.id === id);
}

/** 全文書の h1〜h3 の見出し（本文なし）。 */
export function outlineDocs(store: WebStore): DocOutline[] {
  return store.docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    sourcePath: doc.sourcePath,
    meta: doc.meta,
    headings: doc.sections
      .filter((s) => s.level >= 1 && s.level <= OUTLINE_MAX_LEVEL)
      .map((s) => ({
        level: s.level,
        title: s.title,
        anchor: s.anchor,
        mods: s.mods,
        withoutMods: s.withoutMods,
        hasBody: s.html !== "",
      })),
  }));
}

/** タグごとの、付いている文書と節の数（名前順）。 */
export function tagCounts(store: WebStore): TagCount[] {
  const counts = new Map<string, TagCount>();
  function count(name: string): TagCount {
    let entry = counts.get(name);
    if (entry === undefined) {
      entry = { name, documentCount: 0, sectionCount: 0 };
      counts.set(name, entry);
    }
    return entry;
  }
  for (const doc of store.docs) {
    for (const tag of doc.meta.tags) {
      count(tag).documentCount++;
    }
    for (const section of doc.sections) {
      for (const tag of section.tags) {
        count(tag).sectionCount++;
      }
    }
  }
  return [...counts.values()].sort((a, b) => compareNoCase(a.name, b.name));
}

/** 検索で節のタグを探す列（デスクトップ版の sections.keywords と同じく空白でつなぐ）。 */
export function sectionKeywords(section: Section): string {
  return section.tags.join(" ");
}

function toSummary(doc: DocDetail): DocSummary {
  return {
    id: doc.id,
    title: doc.title,
    sourceType: doc.sourceType,
    sourcePath: doc.sourcePath,
    sourceHash: doc.sourceHash,
    meta: doc.meta,
    sectionCount: doc.sectionCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** order のない文書を後ろに、order、タイトル（大文字小文字を区別しない）、id の順。 */
function compareListOrder(a: DocDetail, b: DocDetail): number {
  const ao = a.meta.order;
  const bo = b.meta.order;
  if (ao === null || bo === null) {
    if (ao !== bo) {
      return ao === null ? 1 : -1;
    }
  } else if (ao !== bo) {
    return ao - bo;
  }
  return firstNonZero(compareNoCase(a.title, b.title), compareBinary(a.id, b.id));
}

function toSections(doc: NormalizedDoc, nextId: () => number, tagNames: TagNames): Section[] {
  // 直前までの見出しを (level, id) で積み、自分より浅い最後の見出しを親にする
  const ancestors: { level: number; id: number }[] = [];
  return doc.sections.map((section, orderIndex): Section => {
    const id = nextId();
    let parentId: number | null = null;
    // 導入部（level 0）は見出しの外にあるので親を持たず、親にもならない
    if (section.level > 0) {
      while ((ancestors.at(-1)?.level ?? 0) >= section.level) {
        ancestors.pop();
      }
      parentId = ancestors.at(-1)?.id ?? null;
      ancestors.push({ level: section.level, id });
    }
    return {
      id,
      parentId,
      level: section.level,
      title: stripMarks(section.title.trim()),
      anchor: section.anchor.trim(),
      orderIndex,
      html: section.html,
      plainText: stripMarks(section.plainText),
      page: null,
      tags: tagNames.sorted(normalizeTags(section.tags)),
      mods: dedup(section.mods),
      withoutMods: dedup(section.withoutMods),
    };
  });
}

function normalizeMeta(meta: DocMeta, tagNames: TagNames): DocMeta {
  return {
    ...meta,
    modVersion: nonEmpty(meta.modVersion),
    verifiedAt: nonEmpty(meta.verifiedAt),
    category: nonEmpty(meta.category),
    gameVersion: nonEmpty(meta.gameVersion),
    aceCommit: nonEmpty(meta.aceCommit)?.toLowerCase() ?? null,
    tags: tagNames.sorted(normalizeTags(meta.tags)),
  };
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function dedup(mods: readonly ModTarget[]): ModTarget[] {
  return [...new Set(mods)];
}

/**
 * タグの表記をそろえる。デスクトップ版のタグの表は大文字小文字を区別せず、最初に保存された表記を全文書で使う。
 * 文書にも節にも、名前順で返す。
 */
class TagNames {
  private readonly names = new Map<string, string>();

  sorted(tags: readonly string[]): string[] {
    return tags
      .map((tag) => {
        const key = asciiLower(tag);
        const existing = this.names.get(key);
        if (existing !== undefined) {
          return existing;
        }
        this.names.set(key, tag);
        return tag;
      })
      .sort(compareNoCase);
  }
}
