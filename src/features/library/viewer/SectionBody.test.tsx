import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChartData, ChartPayload, ChartSpec } from "@/features/content/chart";
import { SectionBody } from "@/features/library/viewer/SectionBody";
import { activeMods } from "@/features/settings/mod-settings";

// ここで確かめるのは、どのデータでグラフを描くかまで。受け取った系列を文字で出す部品に差し替える
// （グラフそのものは ManualLineChart.test.tsx で確かめる）
vi.mock(import("@/features/library/viewer/ManualLineChart"), () => ({
  ManualLineChart: ({ spec, data }: { spec: ChartSpec; data: ChartData }) => (
    <p data-testid="chart">
      {spec.x}: {data.series.map((s) => s.label).join(", ")} / {String(data.points.length)} 点
    </p>
  ),
}));

beforeEach(() => {
  // jsdom には ResizeObserver がない。ブラウザは監視を始めた箱ごとに最初の通知を 1 回送るので、それだけをまねる
  // （はみ出しの見直しは、この通知で、通知された箱だけに行う）
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly #callback: (entries: { target: Element }[]) => void;
      constructor(callback: (entries: { target: Element }[]) => void) {
        this.#callback = callback;
      }
      observe(target: Element): void {
        this.#callback([{ target }]);
      }
      disconnect(): void {
        // 何もしない
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAYLOAD: ChartPayload = {
  spec: { x: "経過", y: ["SpO2"], y2: [], ref: [85], title: null, data: null, unit: null },
  data: {
    xLabel: "経過",
    xUnit: "s",
    series: [{ key: "s0", label: "SpO2", panel: "y", unit: "%" }],
    points: [
      { x: 0, values: { s0: 97.1 } },
      { x: 5, values: { s0: 92 } },
      { x: 10, values: { s0: 88.1 } },
    ],
  },
};

function tableHtml(json: string): string {
  return [
    "<p>前の段落</p>",
    `<table data-chart="${json.replaceAll('"', "&quot;")}">`,
    "<thead><tr><th>経過</th><th>SpO2</th></tr></thead>",
    "<tbody><tr><td>0 s</td><td>97.1%</td></tr><tr><td>5 s</td><td>92.0%</td></tr></tbody>",
    "</table>",
  ].join("");
}

const resolveAsset = (): Promise<string> => Promise.reject(new Error("画像はない"));

const cells = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("th, td")).map((c) => c.textContent);

describe("SectionBody", () => {
  it("data-chart の付いた表の直前に、埋め込まれた点でグラフを描き、表は残す", async () => {
    const { container } = render(
      <SectionBody
        html={tableHtml(JSON.stringify(PAYLOAD))}
        resolveAsset={resolveAsset}
        active={null}
      />,
    );

    // 表は 2 行だが、グラフは data-chart に埋め込まれた 3 点で描く
    expect((await screen.findByTestId("chart")).textContent).toBe("経過: SpO2 / 3 点");
    const figure = container.querySelector("figure.manual-chart");
    expect(figure?.nextElementSibling?.tagName).toBe("TABLE");
    expect(figure?.previousElementSibling?.textContent).toBe("前の段落");
  });

  it("表なしのグラフは data-chart の付いた figure の中に描く", async () => {
    const json = JSON.stringify(PAYLOAD).replaceAll('"', "&quot;");
    const { container } = render(
      <SectionBody
        html={`<p>前の段落</p><figure data-chart="${json}"></figure><p>次の段落</p>`}
        resolveAsset={resolveAsset}
        active={null}
      />,
    );

    expect((await screen.findByTestId("chart")).textContent).toBe("経過: SpO2 / 3 点");
    const figure = container.querySelector("figure.manual-chart");
    expect(figure?.previousElementSibling?.textContent).toBe("前の段落");
    expect(figure?.nextElementSibling?.textContent).toBe("次の段落");
    expect(container.querySelectorAll("figure")).toHaveLength(1);
  });

  it("表なしのグラフの形が合わないときは、空の figure を見せない", async () => {
    const { container } = render(
      <SectionBody
        html='<figure data-chart="{"></figure><p>本文</p>'
        resolveAsset={resolveAsset}
        active={null}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector<HTMLElement>("figure")?.hidden).toBe(true);
    });
    expect(screen.queryByTestId("chart")).toBeNull();
    expect(container.textContent).toBe("本文");
  });

  it("data-chart の形が合わないときは、グラフを描かず表だけを出す", async () => {
    const { container } = render(
      <SectionBody
        html={tableHtml(JSON.stringify({ spec: PAYLOAD.spec }))}
        resolveAsset={resolveAsset}
        active={null}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector<HTMLElement>("figure")?.hidden).toBe(true);
    });
    expect(screen.queryByTestId("chart")).toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("data-flowchart の形が合わないときは、図を描かず、文のリストを隠さない", async () => {
    const { container } = render(
      <SectionBody
        html='<figure data-flowchart="{"><ol class="manual-flowchart-text"><li>確かめる</li></ol></figure>'
        resolveAsset={resolveAsset}
        active={null}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector<HTMLElement>(".manual-flowchart-canvas")?.hidden).toBe(true);
    });
    // 文のリストは、figure に manual-flowchart が付いている間だけ画面から隠れる
    expect(container.querySelector("figure")?.classList.contains("manual-flowchart")).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("確かめる");
  });

  it("data-mod-columns の付いた表は、設定の MOD に合わない組み合わせの列を消す", () => {
    const columns = [
      { mods: [], withoutMods: [] },
      { mods: ["circulation"], withoutMods: [] },
      { mods: [], withoutMods: ["circulation"] },
    ];
    const html = [
      `<table data-mod-columns="${JSON.stringify(columns).replaceAll('"', "&quot;")}">`,
      "<thead><tr><th>項目</th><th>Circulation あり</th><th>Circulation なし</th></tr></thead>",
      "<tbody><tr><td>総量</td><td>750 ml</td><td>1500 ml</td></tr></tbody>",
      "</table>",
    ].join("");

    const filtered = render(
      <SectionBody
        html={html}
        resolveAsset={resolveAsset}
        active={activeMods({ enabled: ["circulation"] })}
      />,
    );
    expect(cells(filtered.container)).toStrictEqual(["項目", "Circulation あり", "総量", "750 ml"]);
    cleanup();

    const all = render(<SectionBody html={html} resolveAsset={resolveAsset} active={null} />);
    expect(cells(all.container)).toHaveLength(6);
  });

  it("表の直前の「…:」で終わる段落を、表の名前にする（グラフの figure を挟んでもよい）", () => {
    const html = [
      "<p>失血の推移:</p>",
      `<table data-chart="${JSON.stringify(PAYLOAD).replaceAll('"', "&quot;")}">`,
      "<thead><tr><th>経過</th><th>SpO2</th></tr></thead><tbody><tr><td>0 s</td><td>97.1%</td></tr></tbody>",
      "</table>",
      "<p>名前にしない段落</p>",
      "<table><tbody><tr><td>a</td></tr></tbody></table>",
    ].join("");
    render(<SectionBody html={html} resolveAsset={resolveAsset} active={null} />);
    const tables = screen.getAllByRole("table");
    expect(tables[0]?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(screen.getByRole("table", { name: "失血の推移:" })).toBe(tables[0]);
    expect(tables[1]?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("「…:」の後ろに空白や改行があっても、表の名前にする", () => {
    const html = [
      "<p>失血の推移: \n</p>",
      "<table><tbody><tr><td>a</td></tr></tbody></table>",
      // 文の途中にコロンがあるだけの段落は、名前にしない
      "<p>注意: 表の説明ではない文</p>",
      "<table><tbody><tr><td>b</td></tr></tbody></table>",
    ].join("");
    render(<SectionBody html={html} resolveAsset={resolveAsset} active={null} />);
    const tables = screen.getAllByRole("table");
    expect(tables[0]?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(tables[1]?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("外部のリンクには、アプリの外で開くことを読み上げ用に足す", () => {
    render(
      <SectionBody
        html='<p><a href="https://example.com/">出典</a> と <a href="other.md#節">別の原稿</a></p>'
        resolveAsset={resolveAsset}
        active={null}
      />,
    );
    expect(screen.getByRole("link", { name: "出典（ブラウザで開く）" })).toBeDefined();
    expect(screen.getByRole("link", { name: "別の原稿" })).toBeDefined();
  });

  it("横にはみ出している箱だけを Tab で止まるようにし、コードの箱には名前を付ける", () => {
    // jsdom は大きさを測れないので、表とコードだけがはみ出していることにする（clientWidth は 0）
    const widths = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.localName === "table" || this.localName === "pre" ? 500 : 0;
      });
    render(
      <SectionBody
        html="<table><tbody><tr><td>広い表</td></tr></tbody></table><pre>長いコード</pre><p>段落</p>"
        resolveAsset={resolveAsset}
        active={null}
      />,
    );
    expect(screen.getByRole("table").tabIndex).toBe(0);
    expect(screen.getByRole("region", { name: "コード" }).tabIndex).toBe(0);
    expect(screen.getByText("段落").hasAttribute("tabindex")).toBe(false);
    widths.mockRestore();
  });
});
