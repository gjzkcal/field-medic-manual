import { describe, expect, it } from "vitest";

import { loadFlowTree } from "@/features/triage/load";
import type { Flow } from "@/features/triage/schema";
import type { TriageDetail } from "@/lib/bindings/TriageDetail";
import { end, makeFlow, simpleFlow, subflow } from "@/test/flows";

function detail(flow: Flow | string, id = typeof flow === "string" ? "x" : flow.id): TriageDetail {
  return {
    id,
    title: id,
    description: null,
    modTargets: [],
    modChannel: null,
    verifiedAt: null,
    version: 1,
    sourceHash: "h",
    updatedAt: "",
    json: typeof flow === "string" ? flow : JSON.stringify(flow),
  };
}

function getterOf(...flows: Flow[]): (id: string) => Promise<TriageDetail> {
  return (id) => {
    const flow = flows.find((f) => f.id === id);
    return flow === undefined
      ? Promise.reject(new Error(`ない: ${id}`))
      : Promise.resolve(detail(flow));
  };
}

describe("loadFlowTree", () => {
  it("入れ子のサブフローまで読む", async () => {
    const leaf = simpleFlow("leaf");
    const middle = makeFlow("middle", "sf", { sf: subflow("leaf", "e"), e: end("e") });
    const root = makeFlow("root", "sf", {
      sf: subflow("middle", "sf2"),
      sf2: subflow("leaf", "e"),
      e: end("e"),
    });
    const loaded = await loadFlowTree("root", getterOf(root, middle, leaf));
    expect(loaded.root.id).toBe("root");
    expect(loaded.lookup("middle")?.id).toBe("middle");
    expect(loaded.lookup("leaf")?.id).toBe("leaf");
  });

  it("サブフローが読めなければ失敗する", async () => {
    const root = makeFlow("root", "sf", { sf: subflow("missing", "e"), e: end("e") });
    await expect(loadFlowTree("root", getterOf(root))).rejects.toThrow(/missing/);
  });

  it("形の違う JSON は失敗する", async () => {
    await expect(
      loadFlowTree("x", () => Promise.resolve(detail(JSON.stringify({ id: "x" })))),
    ).rejects.toThrow(/形が正しくありません/);
    await expect(loadFlowTree("x", () => Promise.resolve(detail("{壊れた")))).rejects.toThrow(
      /JSON を読めません/,
    );
  });
});
