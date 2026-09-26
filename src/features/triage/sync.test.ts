import { describe, expect, it } from "vitest";

import type { FlowSource } from "@/features/triage/bundle";
import { syncFlows, type FlowSyncDeps } from "@/features/triage/sync";
import type { TriageSummary } from "@/lib/bindings/TriageSummary";
import type { TriageUpsertInput } from "@/lib/bindings/TriageUpsertInput";
import { end, makeFlow, question, simpleFlow, subflow } from "@/test/flows";
import type { Flow } from "@/features/triage/schema";

function source(flow: Flow, hash = `hash-${flow.id}`): FlowSource {
  return { fileName: `${flow.id}.flow.json`, text: JSON.stringify(flow), hash };
}

function summary(id: string, sourceHash: string): TriageSummary {
  return {
    id,
    title: id,
    description: null,
    modTargets: [],
    modChannel: null,
    verifiedAt: null,
    version: 1,
    sourceHash,
    updatedAt: "",
  };
}

function fakeDb(
  flows: TriageSummary[],
): FlowSyncDeps & { saved: TriageUpsertInput[]; deleted: string[] } {
  const saved: TriageUpsertInput[] = [];
  const deleted: string[] = [];
  return {
    saved,
    deleted,
    listFlows: () => Promise.resolve(flows),
    saveFlow: (input) => {
      saved.push(input);
      return Promise.resolve();
    },
    deleteFlow: (id) => {
      deleted.push(id);
      return Promise.resolve();
    },
  };
}

describe("syncFlows", () => {
  it("新しいものは保存し、変わっていないものは飛ばし、同梱にないものは消す", async () => {
    const db = fakeDb([
      summary("same", "hash-same"),
      summary("changed", "old"),
      summary("gone", "x"),
    ]);
    const result = await syncFlows(
      [source(simpleFlow("same")), source(simpleFlow("changed")), source(simpleFlow("new"))],
      db,
    );
    expect(result).toMatchObject({ added: 1, updated: 1, unchanged: 1, removed: 1, failed: [] });
    expect(db.saved.map((s) => s.id)).toEqual(["changed", "new"]);
    expect(db.deleted).toEqual(["gone"]);
  });

  it("保存する値をフローから写す", async () => {
    const db = fakeDb([]);
    const flow = makeFlow(
      "meta",
      "q",
      { q: question("出血は？", "e", "e"), e: end("安定") },
      {
        description: "説明",
        modTarget: ["core"],
        modChannel: "dev",
        verifiedAt: "2026-09-26",
        version: 2,
      },
    );
    await syncFlows([source(flow)], db);
    expect(db.saved[0]).toMatchObject({
      id: "meta",
      description: "説明",
      modTargets: ["core"],
      modChannel: "dev",
      verifiedAt: "2026-09-26",
      version: 2,
      sourceHash: "hash-meta",
    });
    expect(db.saved[0]?.searchText.split("\n")[0]).toBe("説明");
    expect(db.saved[0]?.searchText).toContain("出血は？");
    expect(JSON.parse(db.saved[0]?.json ?? "")).toEqual(flow);
  });

  it("検証エラーのフローと、それを呼ぶフローは入れず、前回の内容も消さない", async () => {
    const db = fakeDb([summary("broken", "old"), summary("caller", "old")]);
    const broken = makeFlow("broken", "q", { q: question("q", "e", "missing"), e: end("e") });
    const caller = makeFlow("caller", "sf", { sf: subflow("broken", "e"), e: end("e") });
    const result = await syncFlows([source(broken), source(caller), source(simpleFlow("ok"))], db);
    expect(db.saved.map((s) => s.id)).toEqual(["ok"]);
    expect(db.deleted).toEqual([]);
    expect(result.failed.map((f) => f.fileName)).toEqual(["broken.flow.json", "caller.flow.json"]);
    expect(result.failed[0]?.message).toMatch(/^V2:/);
  });

  it("読めないファイルは失敗にし、ファイル名の id の前回の内容は残す", async () => {
    const db = fakeDb([summary("bad", "old")]);
    const result = await syncFlows(
      [
        { fileName: "bad.flow.yaml", text: "start: [壊れた", hash: "h" },
        { fileName: "shape.flow.json", text: JSON.stringify({ id: "shape" }), hash: "h" },
      ],
      db,
    );
    expect(db.saved).toEqual([]);
    expect(db.deleted).toEqual([]);
    expect(result.failed.map((f) => f.fileName)).toContain("bad.flow.yaml");
    expect(result.failed.map((f) => f.fileName)).toContain("shape.flow.json");
  });

  it("警告は保存したうえで知らせる", async () => {
    const db = fakeDb([]);
    const flow = makeFlow("warn", "q", {
      q: question("q", "e", "e"),
      e: end("e"),
      orphan: end("孤立"),
    });
    const result = await syncFlows([source(flow)], db);
    expect(result.added).toBe(1);
    expect(result.warnings.map((w) => w.fileName)).toEqual(["warn.flow.json"]);
    expect(result.warnings[0]?.message).toMatch(/^V4:/);
  });

  it("YAML も読む", async () => {
    const db = fakeDb([]);
    const yaml = [
      "$schema: ace-triage/v1",
      "id: yaml-flow",
      "title: YAML のフロー",
      "verifiedAt: 2026-09-26",
      "start: e",
      "nodes:",
      "  e:",
      "    type: end",
      "    outcome: ok",
      "    text: 安定",
    ].join("\n");
    const result = await syncFlows(
      [{ fileName: "yaml-flow.flow.yaml", text: yaml, hash: "h" }],
      db,
    );
    expect(result.failed).toEqual([]);
    expect(db.saved[0]).toMatchObject({ id: "yaml-flow", verifiedAt: "2026-09-26" });
  });
});
