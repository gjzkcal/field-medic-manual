import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChartData, ChartSpec } from "@/features/content/chart";
import { ManualLineChart } from "@/features/library/viewer/ManualLineChart";

const SPEC: ChartSpec = {
  x: "経過",
  y: ["SpO2"],
  y2: ["心拍数"],
  ref: [90],
  title: "出血したときの推移",
  data: null,
  unit: null,
};

const DATA: ChartData = {
  xLabel: "経過",
  xUnit: "s",
  series: [
    { key: "s0", label: "SpO2", panel: "y", unit: "%" },
    { key: "s1", label: "心拍数", panel: "y2", unit: null },
  ],
  points: [
    { x: 0, values: { s0: 99, s1: 80 } },
    { x: 60, values: { s0: 95, s1: 110 } },
    // 心拍数は空欄
    { x: 120, values: { s0: 88 } },
  ],
};

function plots(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".touch-pan-y"));
}

/** 線を描く領域が、画面の x=100 から幅 200 にあることにする（jsdom には描画の大きさが無い） */
function placePlot(plot: HTMLElement): void {
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 200, 144));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManualLineChart", () => {
  it("表題と読み上げ用の要約を図の説明にし、図そのものは読み上げから隠す", () => {
    const { container } = render(<ManualLineChart spec={SPEC} data={DATA} withTable />);

    const caption = container.querySelector("figcaption");
    expect(caption?.textContent).toContain("出血したときの推移");
    expect(caption?.textContent).toContain("グラフ: SpO2（%）: 経過 0 s で 99 %");
    expect(caption?.textContent).toContain("値は続く表にもあります。");
    expect(container.querySelector("svg")?.closest("[aria-hidden]")).not.toBeNull();
  });

  it("y と y2 を上下に分けて描き、それぞれに線の名前・目盛り・線を出す", () => {
    const { container } = render(<ManualLineChart spec={SPEC} data={DATA} withTable={false} />);

    expect(plots(container)).toHaveLength(2);
    expect(screen.getByText("SpO2（%）")).toBeDefined();
    expect(screen.getByText("心拍数")).toBeDefined();
    // 横軸は 2 つのグラフに同じ目盛り（秒）
    expect(screen.getAllByText("60 s")).toHaveLength(2);
    // 上のグラフの縦軸は、基準の線（90）も含む 0〜100。基準の線の値は、目盛りとは別に右にも出す
    expect(screen.getAllByText("100")).toHaveLength(1);
    expect(screen.getAllByText("90")).toHaveLength(1);

    const [upper, lower] = plots(container);
    // 0〜120 s を 0〜1000、0〜100 を下から上（144〜0）に置く
    expect(upper?.querySelector("path[fill='none']")?.getAttribute("d")).toBe(
      "M0 1.44L500 7.2L1000 17.28",
    );
    // 値の無い点（120 s の心拍数）は線に入れない
    expect(lower?.querySelector("path[fill='none']")?.getAttribute("d")).toBe("M0 48L500 12");
  });

  it("横軸の目盛りの文字は、グラフが狭いときに 1 つおきに隠れる", () => {
    render(<ManualLineChart spec={SPEC} data={DATA} withTable={false} />);

    // 目盛りは 0・15・30…120 s の 9 個。最初と 4 つおきは常に出し、ほかは幅が足りないときに隠す
    const [first] = screen.getAllByText("0 s");
    const [second] = screen.getAllByText("15 s");
    expect(first?.style.maxWidth).toBe("");
    // 入れ物の幅（cqw）から決まる max-width が付く（式の書き方は jsdom が整理するので、付いていることだけを見る。幅の値は line-chart.test.ts で確かめる）
    expect(second?.style.maxWidth).toContain("cqw");
  });

  it("点が少ないグラフには点の印を付ける", () => {
    const { container } = render(<ManualLineChart spec={SPEC} data={DATA} withTable={false} />);

    const [upper] = plots(container);
    // 点ごとに、背景の色の縁と線の色の 2 つ
    expect(upper?.querySelectorAll("path[stroke-linecap='round']")).toHaveLength(6);
  });

  it("マウスを載せると、最も近い点の値を上下のグラフの両方に出し、離すと消す", () => {
    const { container } = render(<ManualLineChart spec={SPEC} data={DATA} withTable={false} />);
    const [upper] = plots(container);
    if (upper === undefined) {
      throw new Error("グラフが無い");
    }
    placePlot(upper);

    // 幅 200 の 55% の位置 → 66 s → 最も近いのは 60 s の点
    fireEvent.pointerMove(upper, { clientX: 210 });
    expect(screen.getAllByText("経過 60 s")).toHaveLength(2);
    expect(screen.getByText("95")).toBeDefined();
    expect(screen.getByText("110")).toBeDefined();

    // 右端 → 120 s。心拍数は空欄なので、下のグラフには値を出さない
    fireEvent.pointerMove(upper, { clientX: 300 });
    expect(screen.getAllByText("経過 120 s")).toHaveLength(2);
    expect(screen.getByText("88")).toBeDefined();
    expect(screen.queryByText("110")).toBeNull();

    fireEvent.pointerLeave(upper);
    expect(screen.queryByText("経過 120 s")).toBeNull();
  });

  it("表題が無ければ、図の説明は読み上げ用だけにする", () => {
    const { container } = render(
      <ManualLineChart spec={{ ...SPEC, title: null }} data={DATA} withTable={false} />,
    );

    expect(container.querySelector("figcaption")?.className).toBe("sr-only");
  });
});
