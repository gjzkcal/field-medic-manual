// V1〜V8（dev-docs/reference/triage-format.md §3）の正常系と異常系。
import { describe, expect, it } from "vitest";

import { parseFlow } from "@/features/triage/schema";
import {
  hasErrors,
  validateFlow,
  validateFlows,
  type FlowIssue,
  type IssueCode,
} from "@/features/triage/validate";
import {
  action,
  actionWithItems,
  end,
  makeFlow,
  question,
  simpleFlow,
  subflow,
} from "@/test/flows";
import type { Flow } from "@/features/triage/schema";

function validateAlone(flow: Flow): FlowIssue[] {
  return validateFlow(flow, new Map([[flow.id, flow]]));
}

function codes(issues: readonly FlowIssue[], level?: FlowIssue["level"]): IssueCode[] {
  return issues.filter((i) => level === undefined || i.level === level).map((i) => i.code);
}

describe("validateFlow", () => {
  it("正しいフローには何も出ない", () => {
    expect(validateAlone(simpleFlow())).toEqual([]);
  });

  describe("V1: start が nodes にある", () => {
    it("異常: start が存在しない", () => {
      const flow = { ...simpleFlow(), start: "q-none" };
      const issues = validateAlone(flow);
      expect(codes(issues, "error")).toContain("V1");
      expect(hasErrors(issues)).toBe(true);
    });
  });

  describe("V2: next の行き先がある", () => {
    it("異常: 選択肢の next が存在しない", () => {
      const flow = makeFlow("f", "q1", { q1: question("q", "e", "missing"), e: end("e") });
      const issues = validateAlone(flow);
      expect(issues).toContainEqual(expect.objectContaining({ code: "V2", nodeId: "q1" }));
    });

    it("異常: action / subflow の next が存在しない", () => {
      const other = simpleFlow("other");
      const flow = makeFlow("f", "a1", {
        a1: action("a", "sf"),
        sf: subflow("other", "nowhere"),
      });
      const issues = validateFlow(
        flow,
        new Map([
          [flow.id, flow],
          [other.id, other],
        ]),
      );
      expect(issues).toContainEqual(expect.objectContaining({ code: "V2", nodeId: "sf" }));
    });

    it("異常: 持っていないときの行き先（ifMissing.next）が存在しない", () => {
      const flow = makeFlow("f", "a1", {
        a1: actionWithItems("止血帯を巻く", "e", ["止血帯"], "nowhere"),
        e: end("e"),
      });
      expect(validateAlone(flow)).toContainEqual(
        expect.objectContaining({ code: "V2", nodeId: "a1" }),
      );
    });

    it("正常: ifMissing の行き先があれば出ない", () => {
      const flow = makeFlow("f", "a1", {
        a1: actionWithItems("止血帯を巻く", "e", ["止血帯"], "a-alt"),
        "a-alt": action("代わりの処置", "e"),
        e: end("e"),
      });
      expect(validateAlone(flow)).toEqual([]);
    });
  });

  describe("V3: 選択肢は 2〜4 個", () => {
    it("正常: 2 個と 4 個", () => {
      for (const count of [2, 4]) {
        const nexts = Array.from({ length: count }, () => "e");
        const flow = makeFlow("f", "q", { q: question("q", ...nexts), e: end("e") });
        expect(codes(validateAlone(flow))).not.toContain("V3");
      }
    });

    it("異常: 1 個と 5 個", () => {
      for (const count of [1, 5]) {
        const nexts = Array.from({ length: count }, () => "e");
        const flow = makeFlow("f", "q", { q: question("q", ...nexts), e: end("e") });
        expect(validateAlone(flow)).toContainEqual(
          expect.objectContaining({ code: "V3", level: "error", nodeId: "q" }),
        );
      }
    });
  });

  describe("V4: start からたどり着けないノードがない", () => {
    it("異常（警告）: 孤立したノード", () => {
      const flow = makeFlow("f", "q1", {
        q1: question("q", "e", "e"),
        e: end("e"),
        orphan: end("誰も来ない"),
      });
      const issues = validateAlone(flow);
      expect(issues).toContainEqual(
        expect.objectContaining({ code: "V4", level: "warning", nodeId: "orphan" }),
      );
      expect(hasErrors(issues)).toBe(false);
    });
  });

  describe("V5: 行き止まりがない", () => {
    it("異常: end にたどり着けない循環", () => {
      const flow = makeFlow("f", "q1", {
        q1: question("q", "e", "a1"),
        a1: action("a1", "a2"),
        a2: action("a2", "a1"),
        e: end("e"),
      });
      const issues = validateAlone(flow);
      const dead = issues.filter((i) => i.code === "V5").map((i) => i.nodeId);
      expect(dead.sort()).toEqual(["a1", "a2"]);
      expect(hasErrors(issues)).toBe(true);
    });

    it("異常: 持っていないときの行き先が行き止まり", () => {
      const flow = makeFlow("f", "a1", {
        a1: actionWithItems("止血帯を巻く", "e", ["止血帯"], "a-alt"),
        "a-alt": action("代わりの処置", "a-alt"),
        e: end("e"),
      });
      expect(validateAlone(flow)).toContainEqual(
        expect.objectContaining({ code: "V5", nodeId: "a-alt" }),
      );
    });

    it("正常: ifMissing の先だけが end に通じていても、next の側と合わせて行き止まりではない", () => {
      const flow = makeFlow("f", "a1", {
        a1: actionWithItems("止血帯を巻く", "a1", ["止血帯"], "e"),
        e: end("e"),
      });
      expect(codes(validateAlone(flow), "error")).toEqual([]);
    });

    it("異常: end がないフロー", () => {
      const flow = makeFlow("f", "a1", { a1: action("a", "a1") });
      expect(codes(validateAlone(flow), "error")).toContain("V5");
    });

    it("正常: 再評価のループがあっても end に出られればよい", () => {
      const flow = makeFlow("f", "q1", {
        q1: question("q", "a1", "e"),
        a1: action("処置して再評価", "q1"),
        e: end("e"),
      });
      expect(codes(validateAlone(flow), "error")).toEqual([]);
    });
  });

  describe("V6: end を通らない循環", () => {
    it("異常（警告）: 再評価のループは警告だけ", () => {
      const flow = makeFlow("f", "q1", {
        q1: question("q", "a1", "e"),
        a1: action("再評価", "q1"),
        e: end("e"),
      });
      const issues = validateAlone(flow);
      expect(issues).toContainEqual(expect.objectContaining({ code: "V6", level: "warning" }));
      expect(hasErrors(issues)).toBe(false);
    });

    it("異常（警告）: 自分に戻る action", () => {
      const flow = makeFlow("f", "q1", {
        q1: question("q", "a1", "e"),
        a1: action("a", "a1"),
        e: end("e"),
      });
      expect(codes(validateAlone(flow), "warning")).toContain("V6");
    });

    it("正常: 循環がなければ出ない", () => {
      expect(codes(validateAlone(simpleFlow()))).not.toContain("V6");
    });
  });

  describe("V7: サブフローが存在し、再帰していない", () => {
    it("正常: 別のフローを呼ぶ", () => {
      const child = simpleFlow("child");
      const parent = makeFlow("parent", "sf", { sf: subflow("child", "e"), e: end("e") });
      const all = new Map([
        [parent.id, parent],
        [child.id, child],
      ]);
      expect(validateFlow(parent, all)).toEqual([]);
    });

    it("異常: 存在しないフロー", () => {
      const flow = makeFlow("f", "sf", { sf: subflow("nothing", "e"), e: end("e") });
      expect(validateAlone(flow)).toContainEqual(
        expect.objectContaining({ code: "V7", level: "error", nodeId: "sf" }),
      );
    });

    it("異常: 自分自身を呼ぶ", () => {
      const flow = makeFlow("self", "sf", { sf: subflow("self", "e"), e: end("e") });
      expect(validateAlone(flow)).toContainEqual(
        expect.objectContaining({ code: "V7", level: "error", nodeId: "sf" }),
      );
    });

    it("異常: 別のフローを経由して自分に戻る", () => {
      const a = makeFlow("a", "sf", { sf: subflow("b", "e"), e: end("e") });
      const b = makeFlow("b", "sf", { sf: subflow("a", "e"), e: end("e") });
      const all = new Map([
        [a.id, a],
        [b.id, b],
      ]);
      expect(codes(validateFlow(a, all), "error")).toContain("V7");
      expect(codes(validateFlow(b, all), "error")).toContain("V7");
    });
  });

  describe("V8: id はスラッグ", () => {
    it("正常: 英小文字・数字・ハイフン", () => {
      for (const id of ["a", "casualty-first-contact", "flow-2"]) {
        expect(codes(validateAlone(simpleFlow(id)))).not.toContain("V8");
      }
    });

    it("異常: 大文字、_、日本語、ハイフンの位置", () => {
      for (const id of ["Casualty", "a_b", "負傷者", "-a", "a-", "a--b", "a b"]) {
        expect(codes(validateAlone(simpleFlow(id)), "error"), id).toContain("V8");
      }
    });
  });
});

describe("validateFlows", () => {
  it("フローの並びをまとめて検証し、入力と同じ順で返す", () => {
    const child = simpleFlow("child");
    const parent = makeFlow("parent", "sf", { sf: subflow("child", "e"), e: end("e") });
    const result = validateFlows([parent, child]);
    expect(result).toEqual([[], []]);
  });

  it("id の重複はエラー", () => {
    const result = validateFlows([simpleFlow("same"), simpleFlow("same")]);
    expect(result.map((issues) => codes(issues))).toEqual([["duplicate"], ["duplicate"]]);
  });
});

describe("parseFlow（形の検査）", () => {
  it("正しい形を読む", () => {
    const result = parseFlow({
      $schema: "ace-triage/v1",
      id: "a",
      title: "t",
      modTarget: ["core", "circulation"],
      modChannel: "dev",
      verifiedAt: new Date("2026-09-25T00:00:00Z"),
      start: "e",
      nodes: {
        e: { type: "end", text: "e", outcome: "ok", links: ["doc:hemorrhage.md#止血帯を使う"] },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.flow.verifiedAt).toBe("2026-09-25");
  });

  it("違う形は、どこが違うかを返す", () => {
    const result = parseFlow({
      $schema: "ace-triage/v1",
      id: "a",
      title: "t",
      modTarget: ["unknown"],
      start: "e",
      nodes: {
        e: { type: "end", text: "e", outcome: "fine" },
        a: { type: "action", text: "a", next: "e", links: ["doc:<documentId>#x"], hlep: "typo" },
        x: { type: "teleport" },
      },
    });
    expect(result.ok).toBe(false);
    const messages = result.ok ? [] : result.messages.join("\n");
    expect(messages).toMatch(/modTarget\.0/);
    expect(messages).toMatch(/nodes\.e\.outcome/);
    expect(messages).toMatch(/nodes\.a\.links\.0/);
    expect(messages).toMatch(/hlep/);
    expect(messages).toMatch(/nodes\.x/);
  });
});
