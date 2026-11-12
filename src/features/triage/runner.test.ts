import { describe, expect, it } from "vitest";

import { formatPath, parsePath, replay, type FlowLookup } from "@/features/triage/runner";
import type { Flow } from "@/features/triage/schema";
import {
  action,
  actionWithItems,
  branch,
  end,
  makeFlow,
  question,
  simpleFlow,
  subflow,
} from "@/test/flows";

function lookupOf(...flows: Flow[]): FlowLookup {
  const map = new Map(flows.map((f) => [f.id, f]));
  return (id) => map.get(id);
}

const root = simpleFlow("root");
const lookup = lookupOf(root);

describe("replay", () => {
  it("空の経路は start のノード", () => {
    const state = replay(root, lookup, []);
    expect(state.nodeId).toBe("q1");
    expect(state.node.type).toBe("question");
    expect(state.options.map((o) => o.label)).toStrictEqual(["選択肢1", "選択肢2"]);
    expect(state.trail).toStrictEqual([]);
    expect(state.depth).toBe(0);
  });

  it("選択肢の番号をたどり、経路を残す", () => {
    const state = replay(root, lookup, [0]);
    expect(state.nodeId).toBe("a1");
    expect(state.options.map((o) => o.label)).toStrictEqual(["次へ"]);
    expect(state.trail).toStrictEqual([
      expect.objectContaining({ nodeId: "q1", text: "質問1", answer: "選択肢1", depth: 0 }),
    ]);
  });

  it("action は 0 で次へ進み、end では選択肢がない", () => {
    const state = replay(root, lookup, [0, 0]);
    expect(state.nodeId).toBe("e-ok");
    expect(state.node.type).toBe("end");
    expect(state.options).toStrictEqual([]);
    expect(state.path).toStrictEqual([0, 0]);
  });

  it("不正な番号の手前で止め、有効な経路だけを返す", () => {
    expect(replay(root, lookup, [5]).path).toStrictEqual([]);
    expect(replay(root, lookup, [0, 1]).path).toStrictEqual([0]);
    // end の先は進めない
    const state = replay(root, lookup, [1, 0, 0]);
    expect(state.nodeId).toBe("e-ok");
    expect(state.path).toStrictEqual([1]);
  });

  it("戻るは経路を 1 つ短くしたもの", () => {
    const forward = replay(root, lookup, [0, 0]);
    const back = replay(root, lookup, forward.path.slice(0, -1));
    expect(back.nodeId).toBe("a1");
  });

  it("選択肢の tone を渡す", () => {
    const flow = makeFlow("t", "q", {
      q: {
        type: "question",
        text: "q",
        choices: [
          { label: "はい", tone: "yes", next: "e" },
          { label: "いいえ", next: "e" },
        ],
      },
      e: end("e"),
    });
    expect(replay(flow, lookupOf(flow), []).options).toStrictEqual([
      { label: "はい", tone: "yes" },
      { label: "いいえ", tone: null },
    ]);
  });

  describe("物品を持っていないとき", () => {
    const flow = makeFlow("items", "a", {
      a: actionWithItems("止血帯・包帯で止血する", "e", ["止血帯", "包帯"], "a-alt"),
      "a-alt": action("代わりの処置", "e"),
      m: actionWithItems(
        "モルヒネを使う",
        "e",
        ["モルヒネ", "ナロキソン"],
        "e",
        "モルヒネを持っていない",
      ),
      e: end("安定"),
    });
    const items = lookupOf(flow);

    it("「次へ」の次に、物品の名前をつないだ「持っていない」を出す", () => {
      expect(replay(flow, items, []).options).toStrictEqual([
        { label: "次へ", tone: null },
        { label: "止血帯・包帯を持っていない", tone: null },
      ]);
    });

    it("1 番で next、2 番で ifMissing の行き先へ進み、経路に残す", () => {
      expect(replay(flow, items, [0]).nodeId).toBe("e");
      const state = replay(flow, items, [1]);
      expect(state.nodeId).toBe("a-alt");
      expect(state.trail[0]?.answer).toBe("止血帯・包帯を持っていない");
    });

    it("label を書けばそれを使う", () => {
      const labelled = makeFlow("labelled", "m", { m: flow.nodes["m"] ?? end("x"), e: end("e") });
      expect(replay(labelled, lookupOf(labelled), []).options[1]?.label).toBe(
        "モルヒネを持っていない",
      );
    });

    it("ifMissing のない action では 2 番は選べない", () => {
      const state = replay(root, lookup, [0, 1]);
      expect(state.nodeId).toBe("a1");
      expect(state.path).toStrictEqual([0]);
    });
  });

  describe("サブフロー", () => {
    const child = makeFlow("child", "cq", {
      cq: question("子の質問", "ce-warn", "ce-ok"),
      "ce-warn": end("子の結果（注意）", "warn"),
      "ce-ok": end("子の結果"),
    });
    const parent = makeFlow("parent", "q1", {
      q1: question("親の質問", "sf", "pe"),
      sf: subflow("child", "after"),
      after: action("戻ってからの処置", "pe"),
      pe: end("親の結果"),
    });
    const lookup2 = lookupOf(parent, child);

    it("subflow のノードに着いたら、サブフローの start から進む", () => {
      const state = replay(parent, lookup2, [0]);
      expect(state.flow.id).toBe("child");
      expect(state.nodeId).toBe("cq");
      expect(state.depth).toBe(1);
    });

    it("サブフローの end では「元のフローへ戻る」を出し、戻ると next に進む", () => {
      const atEnd = replay(parent, lookup2, [0, 0]);
      expect(atEnd.nodeId).toBe("ce-warn");
      expect(atEnd.options.map((o) => o.label)).toStrictEqual(["元のフローへ戻る"]);

      const back = replay(parent, lookup2, [0, 0, 0]);
      expect(back.flow.id).toBe("parent");
      expect(back.nodeId).toBe("after");
      expect(back.depth).toBe(0);
      expect(back.trail.map((t) => [t.flowId, t.nodeId, t.depth])).toStrictEqual([
        ["parent", "q1", 0],
        ["child", "cq", 1],
        ["child", "ce-warn", 1],
      ]);
    });

    it("start が subflow でも入れる", () => {
      const wrapper = makeFlow("wrapper", "sf", { sf: subflow("child", "we"), we: end("w") });
      const state = replay(wrapper, lookupOf(wrapper, child), []);
      expect(state.flow.id).toBe("child");
      expect(replay(wrapper, lookupOf(wrapper, child), [1, 0]).nodeId).toBe("we");
    });

    it("サブフローが見つからなければ例外（読み込み側で先に確かめる前提）", () => {
      expect(() => replay(parent, lookupOf(parent), [0])).toThrow(/child/u);
    });

    // 「気道と呼吸を確かめる」は「気道を開ける」と「気胸を確かめる」を呼ぶので、2 段の入れ子を経路で再生できること
    it("サブフローの中のサブフローから、順に呼び出し元へ戻る", () => {
      const middle = makeFlow("middle", "sf", {
        sf: subflow("child", "me"),
        me: end("中の結果"),
      });
      const top = makeFlow("top", "sf", { sf: subflow("middle", "after"), after: end("上の結果") });
      const lookup3 = lookupOf(top, middle, child);

      const inner = replay(top, lookup3, []);
      expect([inner.flow.id, inner.nodeId, inner.depth]).toStrictEqual(["child", "cq", 2]);

      // 子の end → 中の end → 上の after の順に「元のフローへ戻る」で上がる
      const midEnd = replay(top, lookup3, [1, 0]);
      expect([midEnd.flow.id, midEnd.nodeId, midEnd.depth]).toStrictEqual(["middle", "me", 1]);
      const after = replay(top, lookup3, [1, 0, 0]);
      expect([after.flow.id, after.nodeId, after.depth]).toStrictEqual(["top", "after", 0]);
      expect(after.path).toStrictEqual([1, 0, 0]);
    });
  });
});

describe("parsePath / formatPath", () => {
  it("番号の列と文字列を相互に変える", () => {
    expect(parsePath("0.1.0")).toStrictEqual([0, 1, 0]);
    expect(formatPath([0, 1, 0])).toBe("0.1.0");
    expect(parsePath("")).toStrictEqual([]);
    expect(parsePath(null)).toStrictEqual([]);
  });

  it("数でない部分から先は捨てる", () => {
    expect(parsePath("0.x.1")).toStrictEqual([0]);
    expect(parsePath("0.-1")).toStrictEqual([0]);
    expect(parsePath("0.1.5")).toStrictEqual([0, 1, 5]);
    expect(parsePath("0.1e3")).toStrictEqual([0]);
  });

  it("長すぎる経路は先頭だけを読む", () => {
    expect(parsePath(Array.from({ length: 2000 }, () => "0").join("."))).toHaveLength(1024);
  });
});

// 動作確認用のループの例: 処置のあと最初の質問に戻れる
describe("再評価のループ", () => {
  it("同じノードを何度も通れる", () => {
    const flow = makeFlow("loop", "q", {
      q: question("出血は？", "a", "e"),
      a: action("止血", "q"),
      e: end("安定"),
    });
    const state = replay(flow, lookupOf(flow), [0, 0, 0, 0, 1]);
    expect(state.nodeId).toBe("e");
    expect(state.trail).toHaveLength(5);
  });
});

describe("replay（branch）", () => {
  // 脈を測れるのは Circulation を入れているときだけ、という形
  const flow = makeFlow("mods", "b-pulse", {
    "b-pulse": branch(
      [
        [["circulation", "breathing"], "q-both"],
        [["circulation"], "q-pulse"],
      ],
      "a-core",
    ),
    "q-both": question("両方", "e", "e"),
    "q-pulse": question("脈がある？", "e", "e"),
    "a-core": action("Core のエピネフリン", "b-again"),
    // 分岐が続いても 1 回で画面に出るノードまで進む
    "b-again": branch([[["hitzones"], "e"]], "e"),
    e: end("終わり"),
  });
  const modsLookup = lookupOf(flow);

  it("mods がすべて有効な最初の case へ自動で進み、経路とパンくずには載せない", () => {
    const both = replay(flow, modsLookup, [], new Set(["core", "circulation", "breathing"]));
    expect(both.nodeId).toBe("q-both");
    expect(both.trail).toStrictEqual([]);

    const circulation = replay(flow, modsLookup, [], new Set(["core", "circulation"]));
    expect(circulation.nodeId).toBe("q-pulse");
  });

  it("どの case にも当たらなければ else へ進む。MOD を渡さなければ Core だけとみなす", () => {
    const core = replay(flow, modsLookup, []);
    expect(core.nodeId).toBe("a-core");
    const next = replay(flow, modsLookup, [0]);
    expect(next.nodeId).toBe("e");
    expect(next.trail.map((t) => t.nodeId)).toStrictEqual(["a-core"]);
  });

  it("core と general は渡さなくても有効", () => {
    const always = makeFlow("always", "b", {
      b: branch([[["core", "general"], "e"]], "x"),
      x: action("来ない", "e"),
      e: end("終わり"),
    });
    expect(replay(always, lookupOf(always), [], new Set()).nodeId).toBe("e");
  });

  it("サブフローの start が branch でも続けて進む", () => {
    const child = makeFlow("child", "b", {
      b: branch([[["breathing"], "q"]], "ce"),
      q: question("気道？", "ce", "ce"),
      ce: end("子の終わり"),
    });
    const parent = makeFlow("parent", "sf", { sf: subflow("child", "e"), e: end("親の終わり") });
    const lookupBoth = lookupOf(parent, child);
    expect(replay(parent, lookupBoth, [], new Set(["breathing"])).nodeId).toBe("q");
    expect(replay(parent, lookupBoth, []).nodeId).toBe("ce");
  });
});
