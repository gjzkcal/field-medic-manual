import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChartData, ChartPayload, ChartSpec } from "@/features/content/chart";
import { SectionBody } from "@/features/library/viewer/SectionBody";

// jsdom には描画の大きさがなく Recharts はグラフを描けないので、受け取った系列を文字で出す部品に差し替える
vi.mock("@/features/library/viewer/ManualChart", () => ({
  ManualChart: ({ spec, data }: { spec: ChartSpec; data: ChartData }) => (
    <p data-testid="chart">
      {spec.x}: {data.series.map((s) => s.label).join(", ")} / {String(data.points.length)} 点
    </p>
  ),
}));

afterEach(cleanup);

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

describe("SectionBody", () => {
  it("data-chart の付いた表の直前に、埋め込まれた点でグラフを描き、表は残す", async () => {
    const { container } = render(
      <SectionBody html={tableHtml(JSON.stringify(PAYLOAD))} resolveAsset={resolveAsset} />,
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
      />,
    );

    expect((await screen.findByTestId("chart")).textContent).toBe("経過: SpO2 / 3 点");
    const figure = container.querySelector("figure.manual-chart");
    expect(figure?.previousElementSibling?.textContent).toBe("前の段落");
    expect(figure?.nextElementSibling?.textContent).toBe("次の段落");
    expect(container.querySelectorAll("figure")).toHaveLength(1);
  });

  it("表なしのグラフの形が合わないときは、空の figure を残さない", () => {
    const { container } = render(
      <SectionBody
        html={`<figure data-chart="{"></figure><p>本文</p>`}
        resolveAsset={resolveAsset}
      />,
    );

    expect(container.querySelector("figure")).toBeNull();
    expect(container.textContent).toBe("本文");
  });

  it("data-chart の形が合わないときは、グラフを描かず表だけを出す", () => {
    const { container } = render(
      <SectionBody
        html={tableHtml(JSON.stringify({ spec: PAYLOAD.spec }))}
        resolveAsset={resolveAsset}
      />,
    );

    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });
});
