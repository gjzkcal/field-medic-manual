// 起動時に、同梱したフローを DB に入れる（dev-docs/reference/bundled-content.md §3）。
// マニュアルと同じく DB は同梱物の写しにする。ただし検証エラーのフローは入れず、前回の内容を残す。
import { create } from "zustand";

import type { SyncIssue } from "@/features/content/sync";
import {
  bundledFlows,
  flowIdOfFileName,
  readFlowSource,
  flowSearchText,
  type FlowSource,
} from "@/features/triage/bundle";
import type { Flow } from "@/features/triage/schema";
import { hasErrors, subflowIds, validateFlows } from "@/features/triage/validate";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";
import type { TriageUpsertInput } from "@/lib/bindings/TriageUpsertInput";
import { errorMessage, triageDelete, triageList, triageUpsert } from "@/lib/tauri";

export interface FlowSyncResult {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** DB に入れなかったフロー（形の誤り、V1〜V8 のエラーなど）。前回の内容が DB に残る */
  failed: SyncIssue[];
  /** 入れたが、直したほうがよい点（V4 / V6 の警告） */
  warnings: SyncIssue[];
}

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
): Promise<FlowSyncResult> {
  const result: FlowSyncResult = {
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    failed: [],
    warnings: [],
  };
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
      result.failed.push(
        ...read.messages.map((message) => ({ fileName: source.fileName, message })),
      );
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

  const existing = new Map((await deps.listFlows()).map((f) => [f.id, f]));
  for (const { source, flow } of parsed) {
    if (rejected.has(flow.id)) {
      continue;
    }
    const current = existing.get(flow.id);
    if (current?.sourceHash === source.hash) {
      result.unchanged++;
      continue;
    }
    try {
      await deps.saveFlow(toUpsertInput(flow, source.hash));
      if (current === undefined) {
        result.added++;
      } else {
        result.updated++;
      }
    } catch (error: unknown) {
      // 1 つのフローの誤りで他のフローの更新を止めない
      result.failed.push({ fileName: source.fileName, message: describeError(error) });
    }
  }

  for (const id of existing.keys()) {
    if (!bundledIds.has(id)) {
      try {
        await deps.deleteFlow(id);
        result.removed++;
      } catch (error: unknown) {
        result.failed.push({ fileName: id, message: describeError(error) });
      }
    }
  }
  return result;
}

export function toUpsertInput(flow: Flow, sourceHash: string): TriageUpsertInput {
  return {
    id: flow.id,
    title: flow.title,
    description: flow.description ?? null,
    modTargets: flow.modTarget ?? [],
    modChannel: flow.modChannel ?? null,
    verifiedAt: flow.verifiedAt ?? null,
    version: flow.version ?? 1,
    // Date などを文字列に揃えた後の値を保存する（実行画面は同じ zod で読み直す）
    json: JSON.stringify(flow),
    searchText: flowSearchText(flow),
    sourceHash,
  };
}

type FlowSyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; result: FlowSyncResult }
  | { status: "error"; message: string };

export const useFlowSync = create<{ state: FlowSyncState }>()(() => ({
  state: { status: "idle" },
}));

/** 同梱したフローを DB に入れる。起動時に 1 回呼ぶ。結果は useFlowSync で見る。 */
export async function syncBundledFlows(): Promise<FlowSyncResult | null> {
  useFlowSync.setState({ state: { status: "syncing" } });
  try {
    const result = await syncFlows(await bundledFlows(), {
      listFlows: triageList,
      saveFlow: triageUpsert,
      deleteFlow: triageDelete,
    });
    useFlowSync.setState({ state: { status: "done", result } });
    return result;
  } catch (error: unknown) {
    useFlowSync.setState({ state: { status: "error", message: errorMessage(error) } });
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : errorMessage(error);
}
