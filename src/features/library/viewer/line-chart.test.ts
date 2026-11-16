import { describe, expect, it } from "vitest";

import type { ChartSeries } from "@/features/content/chart";
import {
  dashOf,
  innerTicks,
  linePath,
  nearestIndex,
  seriesColor,
  tickHideBelow,
  timeTicks,
  valueTicks,
} from "@/features/library/viewer/line-chart";

function series(key: string): ChartSeries {
  return { key, label: key, panel: "y", unit: null };
}

describe("seriesColor・dashOf", () => {
  it("色は順番で割り当て、5 色を超えたら回る", () => {
    expect(seriesColor("s0", 0, false)).toBe("var(--chart-1)");
    expect(seriesColor("s9", 4, false)).toBe("var(--chart-5)");
    expect(seriesColor("s9", 5, false)).toBe("var(--chart-1)");
  });

  it("stable なら、順番ではなく key の番号で決める（線を出し入れしても色と線の種類が変わらない）", () => {
    expect(seriesColor("s3", 0, true)).toBe("var(--chart-4)");
    const shown = [series("s3")];
    expect(dashOf(shown, "s3", true)).toBe("8 3 2 3");
    expect(dashOf(shown, "s3", false)).toBeUndefined();
  });

  it("同じグラフの 2 本目からは破線にする", () => {
    const shown = [series("s0"), series("s1")];
    expect(dashOf(shown, "s0", false)).toBeUndefined();
    expect(dashOf(shown, "s1", false)).toBe("6 3");
  });
});

describe("timeTicks", () => {
  it("短い時間は秒、1 分以上の間隔なら分で書く", () => {
    const short = timeTicks(0, 160);
    expect(short.ticks).toStrictEqual([0, 20, 40, 60, 80, 100, 120, 140, 160]);
    expect(short.tickFormatter(20)).toBe("20 s");
    const long = timeTicks(0, 1800);
    expect(long.ticks).toStrictEqual([0, 300, 600, 900, 1200, 1500, 1800]);
    expect(long.tickFormatter(300)).toBe("5 分");
  });
});

describe("valueTicks", () => {
  it("値をすべて含む、区切りのよい範囲にする", () => {
    expect(valueTicks([67.2, 146.7])).toStrictEqual([0, 40, 80, 120, 160]);
    expect(valueTicks([31, 222])).toStrictEqual([0, 60, 120, 180, 240]);
    expect(valueTicks([0.0326, 0.83, 1])).toStrictEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(valueTicks([97.1, 99.45])).toStrictEqual([0, 25, 50, 75, 100]);
  });

  it("端数の出る間隔でも、目盛りに誤差を出さない", () => {
    expect(valueTicks([0.05, 0.3])).toStrictEqual([0, 0.1, 0.2, 0.3]);
  });

  it("負の値があれば、0 より下にも広げる", () => {
    expect(valueTicks([-12, 30])).toStrictEqual([-20, 0, 20, 40]);
  });

  it("値が無い・すべて 0 でも、幅のある軸にする", () => {
    expect(valueTicks([])).toStrictEqual([0, 1]);
    expect(valueTicks([0, 0])).toStrictEqual([0, 1]);
  });
});

describe("innerTicks", () => {
  it("範囲の中に収まる目盛りだけを打つ", () => {
    expect(innerTicks(3, 47)).toStrictEqual([10, 20, 30, 40]);
    expect(innerTicks(0, 1)).toStrictEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("幅が無ければ、その値だけ", () => {
    expect(innerTicks(5, 5)).toStrictEqual([5]);
  });
});

describe("tickHideBelow", () => {
  it("幅が足りないときは 1 つおきに、さらに足りなければ 3 つおきに隠す", () => {
    // いちばん長い文字は「100 s」の 5 文字（32.5 px）。隣との間 4 px を足した 36.5 px が 8 区間で 292 px、左右の 76 px を足して 368 px
    const labels = ["0 s", "20 s", "40 s", "60 s", "80 s", "100 s", "120 s", "140 s", "160 s"];
    expect(tickHideBelow(labels, 76)).toStrictEqual([
      null,
      368,
      222,
      368,
      null,
      368,
      222,
      368,
      null,
    ]);
  });

  it("全角の文字は広く見積もる", () => {
    // 「10 分」は半角 3 文字 + 全角 1 文字で 31.5 px
    expect(tickHideBelow(["0 分", "10 分"], 0)).toStrictEqual([null, 36]);
  });

  it("目盛りが 1 つなら、隠さない", () => {
    expect(tickHideBelow(["5"], 76)).toStrictEqual([null]);
  });
});

describe("linePath", () => {
  it("点を順につなぎ、座標は小数 2 桁までにする", () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 33.3333, y: 5.005 },
        { x: 100, y: 0 },
      ]),
    ).toBe("M0 10L33.33 5.01L100 0");
  });

  it("値の無い点は飛ばして、前後をつなぐ", () => {
    expect(
      linePath([
        { x: 0, y: undefined },
        { x: 10, y: 1 },
        { x: 20, y: undefined },
        { x: 30, y: 3 },
      ]),
    ).toBe("M10 1L30 3");
    expect(linePath([{ x: 0, y: undefined }])).toBe("");
  });
});

describe("nearestIndex", () => {
  const xs = [0, 5, 10, 15, 100];

  it("最も近い点を返す（真ん中なら手前）", () => {
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 7.5)).toBe(1);
    expect(nearestIndex(xs, 8)).toBe(2);
    expect(nearestIndex(xs, 60)).toBe(4);
  });

  it("範囲の外は、端の点", () => {
    expect(nearestIndex(xs, -3)).toBe(0);
    expect(nearestIndex(xs, 500)).toBe(4);
  });

  it("点が 1 つ・0 個のとき", () => {
    expect(nearestIndex([7], 100)).toBe(0);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});
