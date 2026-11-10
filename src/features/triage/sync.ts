// 起動時に、同梱したフローを DB に入れる。
// マニュアルと同じく DB は同梱物の写しにする。ただし検証エラーのフローは入れず、前回の内容を残す。
import { mirrorBundled } from "@/features/sync/mirror";
import { emptySyncResult, issuesOf, type SyncResult } from "@/features/sync/result";
import { createBundledSync } from "@/features/sync/store";
import type { FlowSource } from "@/features/triage/bundle";
import type { Flow } from "@/features/triage/schema";
import { hasErrors, subflowIds, validateFlows } from "@/features/triage/validate";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";
import type { TriageUpsertInput } from "@/lib/bindings/TriageUpsertInput";
import { triageDelete, triageList, triageUpsert } from "@/lib/tauri";

/** 同期が DB とやり取りする処理。テストでは差し替える。 */
export interface FlowSyncDeps {
  listFlows: () => Promise<TriageSummary[]>;
  saveFlow: (input: TriageUpsertInput) => Promise<void>;
  deleteFlow: (id: string) => Promise<void>;
}

interface Parsed {
  source: FlowSource;
  flow: Flow;
}

export async function syncFlows(
  sources: readonly FlowSource[],
  deps: FlowSyncDeps,
): Promise<SyncResult> {
  // 同梱のフロー（全文）は同期するときに読み込む。画面は useFlowSync のためにこのファイルを読むので、
  // 静的に読むと、同期を使わない Web 版でも最初の JS にフローの原文がすべて入ってしまう
  const { flowIdOfFileName, flowSearchText, readFlowSource } =
    await import("@/features/triage/bundle");
  const result = emptySyncResult();
  // 読めなかったファイルも、ファイル名の id は「同梱にある」として扱う（前回の内容を消さないため）
  const bundledIds = new Set<string>();
  const parsed: Parsed[] = [];
  for (const source of sources) {
    const idFromName = flowIdOfFileName(source.fileName);
    if (idFromName !== null) {
      bundledIds.add(idFromName);
    }
    const read = await readFlowSource(source);
    if (read.ok) {
      bundledIds.add(read.flow.id);
      parsed.push({ source, flow: read.flow });
    } else {
      result.failed.push(...issuesOf(source.fileName, read.messages));
    }
  }

  const issues = validateFlows(parsed.map((p) => p.flow));
  const rejected = new Set<string>();
  parsed.forEach(({ source, flow }, i) => {
    const flowIssues = issues[i] ?? [];
    for (const issue of flowIssues) {
      // 再評価のループ（V6）はフローの正常な形なので、起動のたびに知らせない（pnpm test の原稿の検査でも許している）
      if (issue.code === "V6") {
        continue;
      }
      const target = issue.level === "error" ? result.failed : result.warnings;
      target.push({ fileName: source.fileName, message: `${issue.code}: ${issue.message}` });
    }
    if (hasErrors(flowIssues)) {
      rejected.add(flow.id);
    }
  });
  // 入れなかったフローを呼ぶフローも入れない。実行すると、呼んだ先で止まってしまうため
  const known = new Set(parsed.map((p) => p.flow.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const { source, flow } of parsed) {
      if (rejected.has(flow.id)) {
        continue;
      }
      const broken = subflowIds(flow).find((id) => rejected.has(id) || !known.has(id));
      if (broken !== undefined) {
        rejected.add(flow.id);
        result.failed.push({
          fileName: source.fileName,
          message: `サブフロー「${broken}」を入れられなかったため、このフローも入れません`,
        });
        changed = true;
      }
    }
  }

  await mirrorBundled(
    result,
    parsed
      .filter(({ flow }) => !rejected.has(flow.id))
      .map(({ source, flow }) => ({
        key: flow.id,
        fileName: source.fileName,
        hash: source.hash,
        save: async () => {
          await deps.saveFlow(toUpsertInput(flow, source.hash, flowSearchText(flow)));
          return [];
        },
      })),
    (await deps.listFlows()).map((f) => ({
      key: f.id,
      sourceHash: f.sourceHash,
      label: f.id,
      remove: () => deps.deleteFlow(f.id),
    })),
    // 入れなかったフローも同梱にはあるので、前回の内容を消さない
    bundledIds,
  );
  return result;
}

export function toUpsertInput(
  flow: Flow,
  sourceHash: string,
  searchText: string,
): TriageUpsertInput {
  return {
    id: flow.id,
    title: flow.title,
    description: flow.description ?? null,
    modTargets: flow.modTarget ?? [],
    modChannel: flow.modChannel ?? null,
    verifiedAt: flow.verifiedAt ?? null,
    version: flow.version ?? 1,
    order: flow.order ?? null,
    // Date などを文字列に揃えた後の値を保存する（実行画面は同じ zod で読み直す）
    json: JSON.stringify(flow),
    searchText,
    sourceHash,
  };
}

/** 同梱したフローを DB に入れる。起動時に 1 回呼ぶ。結果は useFlowSync で見る。 */
export const { useSync: useFlowSync, sync: syncBundledFlows } = createBundledSync(async () => {
  const { bundledFlows } = await import("@/features/triage/bundle");
  return syncFlows(await bundledFlows(), {
    listFlows: triageList,
    saveFlow: triageUpsert,
    deleteFlow: triageDelete,
  });
});
