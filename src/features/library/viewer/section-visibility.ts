// 原稿の節のうち、設定の「使っている MOD」に合うものを選ぶ。節の条件は変換のときに親の見出しの条件を合わせてあるので、
// 隠れる見出しの配下も自分の条件で隠れる。本文がなく配下がすべて隠れる入れ物の見出し（「MOD による違い」）も隠す。
import {
  hasModConditions,
  meetsModConditions,
  type ModConditions,
} from "@/features/settings/mod-conditions";
import type { ActiveMods } from "@/features/triage/runner";

export interface VisibilitySection extends ModConditions {
  /** 0 = 導入部 */
  level: number;
  anchor: string;
  /** 見出しの下に本文があるか */
  hasBody: boolean;
}

export interface SectionVisibility {
  /** 出す節のアンカー */
  visible: ReadonlySet<string>;
  /** 隠れるはずだが、URL のアンカーで直接開いたので出している節のまとまりの先頭 */
  forcedRoot: string | null;
  /** 隠している節の数 */
  hiddenCount: number;
  /** 条件の付いた節があるか（なければ切り替えの表示を出さない） */
  hasConditions: boolean;
  /**
   * 見出しの代わりに小さなラベル（「Circulation あり」）で出す節。絞り込み中は自分に合う組み合わせしか出ないので、
   * 「〜を入れている場合」の見出しが並ぶと本文が細切れに見えるため。目次とツリーからも外す
   */
  labeled: ReadonlySet<string>;
}

export function sectionVisibility(
  sections: readonly VisibilitySection[],
  active: ActiveMods,
  showAll: boolean,
  target: string | null,
): SectionVisibility {
  const meets = (s: VisibilitySection): boolean => showAll || meetsModConditions(s, active);
  const forcedRange = forcedRangeOf(sections, meets, target);
  const visible = new Set(
    sections
      .filter((s, i) => meets(s) || (forcedRange !== null && inRange(i, forcedRange)))
      .map((s) => s.anchor),
  );
  hideEmptyWrappers(sections, visible);
  // すべて出すときと、直接開いた節（隠れるはずの節）は、どの組み合わせの話か分かるよう見出しのままにする
  const labeled = showAll
    ? new Set<string>()
    : new Set(
        [...conditionRoots(sections)].filter((anchor) => {
          const section = sections.find((s) => s.anchor === anchor);
          return section !== undefined && meetsModConditions(section, active);
        }),
      );
  return {
    visible,
    forcedRoot: forcedRange === null ? null : (sections[forcedRange.start]?.anchor ?? null),
    hiddenCount: sections.length - visible.size,
    hasConditions: sections.some(hasModConditions),
    labeled,
  };
}

/**
 * 条件が新しく付く節（自分の印で条件が増えた節）のアンカー。条件は親から子へ合わせてあるので、
 * 親より条件が多い節が印を書いた節になる。配下の話題の見出し（「心停止中の SpO2 の式」など）は含まない
 */
export function conditionRoots(sections: readonly VisibilitySection[]): ReadonlySet<string> {
  const count = (s: ModConditions): number => s.mods.length + s.withoutMods.length;
  const roots = new Set<string>();
  sections.forEach((section, index) => {
    if (section.level === 0 || !hasModConditions(section)) {
      return;
    }
    const parent = sections[parentIndex(sections, index)];
    if (parent === undefined || count(parent) < count(section)) {
      roots.add(section.anchor);
    }
  });
  return roots;
}

/**
 * 本文がなく、配下の節がすべて隠れた見出しを visible から除く。見出しだけが空で残るのを防ぐため。
 * 入れ物が入れ子になっていても内側から決まるよう、後ろから見る
 */
function hideEmptyWrappers(sections: readonly VisibilitySection[], visible: Set<string>): void {
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index];
    if (section === undefined || section.level === 0 || section.hasBody) {
      continue;
    }
    const children = descendantsOf(sections, index);
    if (children.length > 0 && children.every((child) => !visible.has(child.anchor))) {
      visible.delete(section.anchor);
    }
  }
}

function descendantsOf(
  sections: readonly VisibilitySection[],
  index: number,
): readonly VisibilitySection[] {
  const level = sections[index]?.level ?? 0;
  let end = index + 1;
  while ((sections[end]?.level ?? 0) > level) {
    end += 1;
  }
  return sections.slice(index + 1, end);
}

interface Range {
  start: number;
  /** 含まない */
  end: number;
}

function inRange(index: number, range: Range): boolean {
  return index >= range.start && index < range.end;
}

/**
 * リンク・検索・お気に入りで隠れる節を開いたときに出す範囲。行き止まりにしないため、その節と配下を出す。
 * 親の見出しも隠れるなら、見出しの並びが崩れないよう、隠れている一番上の親からまとめて出す。
 */
function forcedRangeOf(
  sections: readonly VisibilitySection[],
  meets: (s: VisibilitySection) => boolean,
  target: string | null,
): Range | null {
  let root = sections.findIndex((s) => s.anchor === target);
  const found = sections[root];
  if (found === undefined || meets(found)) {
    return null;
  }
  for (let parent = parentIndex(sections, root); parent !== -1;) {
    const section = sections[parent];
    if (section === undefined || meets(section)) {
      break;
    }
    root = parent;
    parent = parentIndex(sections, root);
  }
  return { start: root, end: root + 1 + descendantsOf(sections, root).length };
}

/** 自分より浅い直前の見出し。導入部（level 0）は親にならない */
function parentIndex(sections: readonly VisibilitySection[], index: number): number {
  const level = sections[index]?.level ?? 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = sections[i]?.level ?? 0;
    if (candidate > 0 && candidate < level) {
      return i;
    }
  }
  return -1;
}
