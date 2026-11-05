import { describe, expect, it } from "vitest";

import type { FlowNode } from "@/features/triage/schema";
import { marchOf } from "@/features/triage/view/march";
import { action, end, makeFlow, subflow } from "@/test/flows";

describe("marchOf", () => {
  const plain = action("包帯を巻く", "e");
  const own: FlowNode = { type: "action", text: "回復体位にする", next: "e", march: ["a"] };

  it("ノードに書いた march を使う", () => {
    const flow = makeFlow("f", "a", { a: own, e: end("終わり") }, { march: ["c"] });
    expect(marchOf(flow, own)).toEqual(["a"]);
  });

  it("ノードに無ければ、フロー全体の march を使う", () => {
    const flow = makeFlow("f", "a", { a: plain, e: end("終わり") }, { march: ["w", "s"] });
    expect(marchOf(flow, plain)).toEqual(["w", "s"]);
  });

  it("どちらにも無ければ空。画面に出ない subflow には付けない", () => {
    const sf = subflow("g", "e");
    expect(marchOf(makeFlow("f", "a", { a: plain, e: end("終わり") }), plain)).toEqual([]);
    expect(marchOf(makeFlow("f", "s", { s: sf, e: end("終わり") }, { march: ["m"] }), sf)).toEqual(
      [],
    );
  });
});
