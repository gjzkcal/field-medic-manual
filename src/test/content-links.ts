// 原稿の検査（フロー・クイック表）で、リンクの行き先が同梱物にあるかを確かめる共通部品。
import { bundledManuals } from "@/features/content/bundle";
import { convertManual } from "@/features/content/markdown";
import { bundledQuickref, readQuickrefSource } from "@/features/quickref/bundle";
import { bundledFlows, readFlowSource } from "@/features/triage/bundle";
import type { FlowLink } from "@/features/triage/links";
import { readRepoFile } from "@/test/samples";

export interface LinkTargets {
  /** マニュアルのファイル名 → 見出しのアンカー */
  anchorsByFile: ReadonlyMap<string, ReadonlySet<string>>;
  flowIds: ReadonlySet<string>;
  quickrefIds: ReadonlySet<string>;
}

/** 同梱のマニュアル・フロー・クイック表を読み、リンクの行き先の一覧を作る。 */
export async function loadLinkTargets(): Promise<LinkTargets> {
  const manuals = await Promise.all(
    (await bundledManuals()).map(async (manual) => convertManual(manual, readRepoFile)),
  );
  const flows = await Promise.all((await bundledFlows()).map(readFlowSource));
  const quickrefSource = await bundledQuickref();
  const quickref = quickrefSource === null ? null : await readQuickrefSource(quickrefSource);
  return {
    anchorsByFile: new Map(
      manuals.map(({ doc }) => [
        doc.sourcePath.replace("bundle://manuals/", ""),
        new Set(doc.sections.map((s) => s.anchor)),
      ]),
    ),
    flowIds: new Set(flows.flatMap((r) => (r.ok ? [r.flow.id] : []))),
    quickrefIds: new Set(quickref?.ok === true ? quickref.file.rows.map((r) => r.id) : []),
  };
}

export function linkTargetExists(link: FlowLink | null, targets: LinkTargets): boolean {
  switch (link?.kind) {
    case undefined:
      return false;
    case "external":
      return true;
    case "flow":
      return targets.flowIds.has(link.flowId);
    case "quickref":
      return targets.quickrefIds.has(link.rowId);
    case "doc":
      return (
        targets.anchorsByFile.has(link.fileName) &&
        (link.anchor === null ||
          targets.anchorsByFile.get(link.fileName)?.has(link.anchor) === true)
      );
  }
}
