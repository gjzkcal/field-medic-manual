import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadSectionParts,
  sectionPart,
  type SectionScope,
} from "@/features/chat/chat-chart-sections";
import type { ChartPart } from "@/features/chat/chat-chart";
import type { ChartPayload } from "@/features/content/chart";
import type { ChartSection } from "@/lib/bindings/ChartSection";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { Section } from "@/lib/bindings/Section";

const SOURCE = "doc:oxygen-mask.md#効果";

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** 変換が表や figure に付けるのと同じ形の `data-chart`。 */
function chartAttribute(payload: ChartPayload): string {
  return `data-chart="${escapeAttribute(JSON.stringify(payload))}"`;
}

const MASK: ChartPayload = {
  spec: {
    x: "経過",
    y: ["SpO2"],
    y2: ["肺の酸素"],
    ref: [],
    title: null,
    data: "data/oxygen-mask.csv",
    unit: null,
  },
  data: {
    xLabel: "経過",
    xUnit: "s",
    series: [
      { key: "s0", label: "SpO2", panel: "y", unit: "%" },
      { key: "s1", label: "肺の酸素", panel: "y2", unit: "kPa" },
    ],
    points: [
      { x: 0, values: { s0: 97.15, s1: 13.3 } },
      { x: 10, values: { s0: 98.05 } },
      { x: 20, values: { s0: 98.6, s1: 40.1 } },
    ],
  },
};

const CONCENTRATION: ChartPayload = {
  spec: { x: "経過", y: ["濃度"], y2: [], ref: [], title: null, data: "data/x.csv", unit: "nM" },
  data: {
    xLabel: "経過",
    xUnit: "s",
    series: [{ key: "s0", label: "濃度", panel: "y", unit: "nM" }],
    points: [
      { x: 0, values: { s0: 0 } },
      { x: 5, values: { s0: 120 } },
    ],
  },
};

const PLAIN_TABLE = `<table><thead><tr><th>血液</th><th>心拍数</th><th>状態</th></tr></thead>
<tbody><tr><td>100%</td><td>80 bpm</td><td>正常</td></tr><tr><td>80%</td><td>110 bpm</td><td>頻脈</td></tr>
<tr><td>60%</td><td>140 bpm</td><td>—</td></tr></tbody></table>`;

function scope(...htmls: string[]): SectionScope {
  return {
    docId: "doc-mask",
    docTitle: "酸素マスク",
    anchor: "効果",
    title: "効果",
    // 先頭が指した節、後ろは配下の節
    sections: htmls.map((html, i) => ({ title: i === 0 ? "効果" : `小見出し ${String(i)}`, html })),
  };
}

function target(lines: string[] = [], x = ""): ChartSection {
  return { source: SOURCE, x, lines };
}

function part(value: ChartPart | string): ChartPart {
  if (typeof value === "string") {
    throw new TypeError(`作れるはず: ${value}`);
  }
  return value;
}

describe("節のグラフ", () => {
  const html = `<p>説明</p><table ${chartAttribute(MASK)}><tbody></tbody></table>`;

  it("線を指定しなければ、節のグラフの線を全部、値をそのまま取る", () => {
    const made = part(sectionPart(target(), scope(html)));
    expect(made.lines).toStrictEqual([
      {
        label: "SpO2（酸素マスク）",
        axis: "unit:%",
        unit: "%",
        xLabel: "経過",
        xUnit: "s",
        origin: "原稿「酸素マスク > 効果」のグラフの値",
        points: [
          { x: 0, y: 97.15 },
          { x: 10, y: 98.05 },
          { x: 20, y: 98.6 },
        ],
      },
      {
        label: "肺の酸素（酸素マスク）",
        axis: "unit:kPa",
        unit: "kPa",
        xLabel: "経過",
        xUnit: "s",
        origin: "原稿「酸素マスク > 効果」のグラフの値",
        // 値のない点は飛ばす
        points: [
          { x: 0, y: 13.3 },
          { x: 20, y: 40.1 },
        ],
      },
    ]);
    expect(made.condition).toBe("原稿「酸素マスク > 効果」のグラフの線: SpO2、肺の酸素");
    expect(made.source).toStrictEqual({
      title: "酸素マスク > 効果",
      docId: "doc-mask",
      anchor: "効果",
    });
  });

  it("名前で線を選べる（凡例の「名前（単位）」の形でも）", () => {
    expect(
      part(sectionPart(target(["肺の酸素"]), scope(html))).lines.map((l) => l.label),
    ).toStrictEqual(["肺の酸素（酸素マスク）"]);
    expect(part(sectionPart(target(["SpO2（%）"]), scope(html))).lines).toHaveLength(1);
  });

  it("配下の節にある、表のないグラフも探す", () => {
    const child = `<figure ${chartAttribute(CONCENTRATION)}></figure>`;
    const made = part(sectionPart(target(["濃度"]), scope("<p>親の節</p>", child)));
    expect(made.lines[0]).toMatchObject({
      label: "濃度（酸素マスク）",
      axis: "unit:nM",
      origin: "原稿「酸素マスク > 小見出し 1」のグラフの値",
    });
  });

  it("ない線は、使える線の名前と表の列を添えて理由を返す", () => {
    const message = sectionPart(target(["血圧"]), scope(html, PLAIN_TABLE));
    expect(message).toContain("「血圧」という線はありません。この節のグラフの線: SpO2、肺の酸素。");
    expect(message).toContain("グラフになっていない表の列: [血液, 心拍数, 状態]");
  });

  it("グラフのない節と、形の壊れた data-chart は理由を返す", () => {
    expect(sectionPart(target(), scope("<p>文だけ</p>"))).toBe(`${SOURCE} にグラフがありません。`);
    expect(sectionPart(target(), scope(`<table data-chart="{}"></table>`))).toContain(
      "グラフがありません",
    );
  });
});

describe("グラフになっていない表", () => {
  it("横軸と縦の列を指定すると、セルの値から線を作る", () => {
    const made = part(sectionPart(target(["心拍数"], "血液"), scope("<p>前</p>", PLAIN_TABLE)));
    expect(made.lines).toStrictEqual([
      {
        label: "心拍数（酸素マスク）",
        axis: "unit:bpm",
        unit: "bpm",
        xLabel: "血液",
        xUnit: "%",
        // 値を取ったのは配下の節。指した節ではなく、実際の節を返す
        origin: "原稿「酸素マスク > 小見出し 1」の表の値",
        // 表は血液の多い順に並んでいるが、線の点は横軸の小さい順にする
        points: [
          { x: 60, y: 140 },
          { x: 80, y: 110 },
          { x: 100, y: 80 },
        ],
      },
    ]);
    expect(made.condition).toBe("原稿「酸素マスク > 効果」の表の線: 心拍数");
  });

  it("列がなければ、表の列を添えて理由を返す", () => {
    const message = sectionPart(target(["血圧"], "血液"), scope(PLAIN_TABLE));
    expect(message).toContain("表から線を作れませんでした");
    expect(message).toContain("列「血圧」が表にありません（表の列: 血液, 心拍数, 状態）");
    expect(sectionPart(target(["心拍数"], "血液"), scope("<p>文だけ</p>"))).toContain(
      "グラフになっていない表がありません",
    );
  });

  it("同じ見出しの列が 2 つある表は、先頭の列を使わずに理由を返す", () => {
    const twice = `<table><thead><tr><th>経過</th><th>圧</th><th>圧</th></tr></thead>
<tbody><tr><td>0 s</td><td>10 kPa</td><td>90 kPa</td></tr><tr><td>30 s</td><td>20 kPa</td><td>80 kPa</td></tr></tbody></table>`;
    expect(sectionPart(target(["圧"], "経過"), scope(twice))).toContain(
      "列「圧」が表に 2 つ以上あります（表の列: 経過, 圧, 圧）",
    );
    // 指していない列が重なっているだけなら、使える
    const other = `<table><thead><tr><th>経過</th><th>脈</th><th>圧</th><th>圧</th></tr></thead>
<tbody><tr><td>0 s</td><td>60 bpm</td><td>10 kPa</td><td>90 kPa</td></tr>
<tr><td>30 s</td><td>70 bpm</td><td>20 kPa</td><td>80 kPa</td></tr></tbody></table>`;
    expect(part(sectionPart(target(["脈"], "経過"), scope(other))).lines[0]?.points).toStrictEqual([
      { x: 0, y: 60 },
      { x: 30, y: 70 },
    ]);
  });
});

/** 「量」と「心拍数」の列の表。 */
function amountTable(rows: string): string {
  return `<table><thead><tr><th>量</th><th>心拍数</th></tr></thead><tbody>${rows}</tbody></table>`;
}

describe("どれを指したか決められないとき", () => {
  const chart = `<figure ${chartAttribute(CONCENTRATION)}></figure>`;

  it("同じ名前の線が複数の節にあれば、名前で選ばせずに節を選び直させる", () => {
    const message = sectionPart(target(["濃度"]), scope("<p>親</p>", chart, chart));
    expect(message).toBe(
      `${SOURCE} には「濃度」という線が 2 本あります（節: 「小見出し 1」、「小見出し 2」）。使う線のある節の source を指定してください`,
    );
  });

  it("線を全部使うときは、名前の重なる線の凡例に節の見出しを付ける", () => {
    const made = part(sectionPart(target(), scope("<p>親</p>", chart, chart)));
    expect(made.lines.map((l) => l.label)).toStrictEqual([
      "濃度（酸素マスク > 小見出し 1）",
      "濃度（酸素マスク > 小見出し 2）",
    ]);
  });

  it("指した節そのものに 1 本だけあれば、配下の節に同じ名前があってもそれを使う", () => {
    const made = part(sectionPart(target(["濃度"]), scope(chart, chart)));
    expect(made.lines.map((l) => l.origin)).toStrictEqual([
      "原稿「酸素マスク > 効果」のグラフの値",
    ]);
  });

  it("列の合う表が配下の節に複数あれば、最初の表を使わずに節を選び直させる", () => {
    const message = sectionPart(
      target(["心拍数"], "血液"),
      scope("<p>親</p>", PLAIN_TABLE, PLAIN_TABLE),
    );
    expect(message).toBe(
      `${SOURCE} には、列の合う表が 2 つあります（節: 「小見出し 1」、「小見出し 2」）。使う表のある節の source を指定してください`,
    );
    // 指した節そのものの表は、配下に同じ列の表があっても選べる
    const made = part(sectionPart(target(["心拍数"], "血液"), scope(PLAIN_TABLE, PLAIN_TABLE)));
    expect(made.lines[0]?.origin).toBe("原稿「酸素マスク > 効果」の表の値");
  });

  it("表を使う指定では、グラフ付きの表を候補にしない", () => {
    // グラフ付きの表にも「血液」「心拍数」の列があるが、こちらは節のグラフの線として使うもの
    const charted = PLAIN_TABLE.replace("<table>", `<table ${chartAttribute(MASK)}>`);
    const made = part(
      sectionPart(target(["心拍数"], "血液"), scope("<p>親</p>", charted, PLAIN_TABLE)),
    );
    expect(made.lines[0]?.origin).toBe("原稿「酸素マスク > 小見出し 2」の表の値");
    expect(sectionPart(target(["心拍数"], "血液"), scope(charted))).toContain(
      "グラフになっていない表がありません",
    );
  });

  it("列の中で単位が混ざった表は、線にしない（秒と分は秒にそろえるので使える）", () => {
    const mixed = amountTable(
      "<tr><td>500 mL</td><td>80 bpm</td></tr><tr><td>1 L</td><td>110 bpm</td></tr>",
    );
    expect(sectionPart(target(["心拍数"], "量"), scope(mixed))).toBe(
      `${SOURCE} の表は、列の中で単位が混ざっているので線にできません: 「量」（mL、L）`,
    );
    // 見出しに s を含む列も見つけて調べる（空白をそろえる処理が、見出しの文字を変えないこと）
    const english = mixed.replace("<th>量</th>", "<th>Dose  given</th>");
    expect(sectionPart(target(["心拍数"], "Dose given"), scope(english))).toContain(
      "単位が混ざっているので線にできません: 「Dose given」（mL、L）",
    );
    const time = amountTable(
      "<tr><td>30 秒</td><td>80 bpm</td></tr><tr><td>2 分</td><td>110 bpm</td></tr>",
    );
    expect(part(sectionPart(target(["心拍数"], "量"), scope(time))).lines[0]?.points).toStrictEqual(
      [
        { x: 30, y: 80 },
        { x: 120, y: 110 },
      ],
    );
  });
});

function section(
  id: number,
  level: number,
  title: string,
  html: string,
  mods: ModTarget[] = [],
): Section {
  return {
    id,
    parentId: null,
    level,
    title,
    anchor: title,
    orderIndex: id,
    html,
    plainText: "",
    page: null,
    tags: [],
    mods,
    withoutMods: [],
  };
}

describe("loadSectionParts", () => {
  afterEach(() => {
    clearMocks();
  });

  const META = {
    modTarget: null,
    modChannel: null,
    modVersion: null,
    verifiedAt: null,
    tags: [],
    order: null,
    category: null,
    aceCommit: null,
    gameVersion: null,
  };
  const chart = `<figure ${chartAttribute(CONCENTRATION)}></figure>`;
  const DETAIL: DocDetail = {
    id: "doc-mask",
    title: "酸素マスク",
    sourceType: "markdown",
    sourcePath: "bundle://manuals/oxygen-mask.md",
    sourceHash: "h",
    meta: META,
    sectionCount: 4,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    originalAssetId: null,
    assets: [],
    sections: [
      section(1, 1, "効果", "<p>親</p>"),
      section(2, 2, "Circulation あり", chart, ["circulation"]),
      section(3, 2, "いつでも", `<table ${chartAttribute(MASK)}><tbody></tbody></table>`),
      section(4, 1, "次の節", chart),
    ],
  };

  function mockDocs(): void {
    mockIPC((cmd) => {
      if (cmd === "doc_outline") {
        return [
          {
            id: "doc-mask",
            title: "酸素マスク",
            sourcePath: DETAIL.sourcePath,
            meta: META,
            headings: [],
          },
        ];
      }
      return cmd === "doc_get" ? DETAIL : null;
    });
  }

  it("配下の節は、利用者の MOD に合うものだけを探す（同じレベルの次の節は探さない）", async () => {
    mockDocs();
    const withCirculation = await loadSectionParts([target()], new Set<ModTarget>(["circulation"]));
    const without = await loadSectionParts([target()], new Set<ModTarget>());
    if (typeof withCirculation === "string" || typeof without === "string") {
      throw new TypeError("作れるはず");
    }
    expect(withCirculation[0]?.lines.map((l) => l.label)).toStrictEqual([
      "濃度（酸素マスク）",
      "SpO2（酸素マスク）",
      "肺の酸素（酸素マスク）",
    ]);
    expect(without[0]?.lines.map((l) => l.label)).toStrictEqual([
      "SpO2（酸素マスク）",
      "肺の酸素（酸素マスク）",
    ]);
  });

  it("別々の指定で同じ名前の線を取ったら、凡例に節の見出しを付ける", async () => {
    mockDocs();
    const parts = await loadSectionParts(
      [
        { source: "doc:oxygen-mask.md#Circulation あり", x: "", lines: [] },
        { source: "doc:oxygen-mask.md#次の節", x: "", lines: [] },
      ],
      new Set<ModTarget>(["circulation"]),
    );
    if (typeof parts === "string") {
      throw new TypeError(parts);
    }
    expect(parts.flatMap((p) => p.lines.map((l) => l.label))).toStrictEqual([
      "濃度（酸素マスク > Circulation あり）",
      "濃度（酸素マスク > 次の節）",
    ]);
  });

  it("見出しのない source と、ない節は理由を返す", async () => {
    mockDocs();
    const active = new Set<ModTarget>();
    expect(
      await loadSectionParts([{ source: "doc:oxygen-mask.md", x: "", lines: [] }], active),
    ).toContain("節を指していません");
    expect(
      await loadSectionParts([{ source: "doc:oxygen-mask.md#ない", x: "", lines: [] }], active),
    ).toBe("doc:oxygen-mask.md#ない の節が見つかりません");
  });
});
