import { useId, useLayoutEffect, useMemo, useRef, type JSX } from "react";

import type { FlowchartPayload } from "@/features/content/flowchart";
import {
  EDGE_FONT_SIZE,
  EDGE_LINE_HEIGHT,
  edgePath,
  estimateTextWidth,
  FONT_SIZE,
  layoutFlowchart,
  LINE_HEIGHT,
  type MeasureText,
  type PlacedNode,
} from "@/features/library/viewer/flowchart-layout";
import { CONTENT_RENDERED_EVENT } from "@/features/search/highlight";

interface ManualFlowchartProps {
  payload: FlowchartPayload;
}

/**
 * 原稿のフローチャート。色と線は CSS（.manual-flowchart）でテーマに合わせ、ここでは位置と大きさだけを属性で書く
 * （無害化の方針でインラインの style を使わないため）。
 * 読み上げは figure の中の文のリストが担うので、SVG は読み上げから外す。
 */
export function ManualFlowchart({ payload }: ManualFlowchartProps): JSX.Element {
  // 矢印の marker は本文の中の図ごとに別の id にする。url(#…) で参照するので、React の id の記号を除いて名前に使える文字だけにする
  const markerId = `flowchart-arrow-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const layout = useMemo(() => layoutFlowchart(payload, measureText()), [payload]);
  const arrow = `url(#${markerId})`;
  const svgRef = useRef<SVGSVGElement>(null);

  // 検索語のハイライトを図の文字にも付け直してもらう（図は本文より遅れて描かれるため）
  useLayoutEffect(() => {
    svgRef.current?.dispatchEvent(new Event(CONTENT_RENDERED_EVENT, { bubbles: true }));
  }, [layout]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      width={`${String(layout.width / FONT_SIZE)}em`}
      height={`${String(layout.height / FONT_SIZE)}em`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path className="manual-flowchart-arrow" d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {layout.edges.map((edge, i) => (
        <path
          key={`edge-${String(i)}`}
          className={
            edge.dashed
              ? "manual-flowchart-edge manual-flowchart-edge-dashed"
              : "manual-flowchart-edge"
          }
          d={edgePath(edge.points)}
          markerEnd={arrow}
        />
      ))}
      {layout.nodes.map((placed) => (
        <g
          key={placed.node.id}
          className={`manual-flowchart-node manual-flowchart-${placed.node.shape}`}
        >
          <NodeShape placed={placed} />
          <TextLines
            lines={placed.node.lines}
            x={placed.x}
            y={placed.y}
            fontSize={FONT_SIZE}
            lineHeight={LINE_HEIGHT}
          />
        </g>
      ))}
      {layout.edges.map((edge, i) =>
        edge.label === null ? null : (
          <g key={`label-${String(i)}`} className="manual-flowchart-edge-label">
            <rect
              x={edge.label.x - edge.label.width / 2}
              y={edge.label.y - edge.label.height / 2}
              width={edge.label.width}
              height={edge.label.height}
              rx="3"
            />
            <TextLines
              lines={edge.lines}
              x={edge.label.x}
              y={edge.label.y}
              fontSize={EDGE_FONT_SIZE}
              lineHeight={EDGE_LINE_HEIGHT}
            />
          </g>
        ),
      )}
    </svg>
  );
}

function NodeShape({ placed }: { placed: PlacedNode }): JSX.Element {
  const { x, y, width, height } = placed;
  const left = x - width / 2;
  const top = y - height / 2;
  switch (placed.node.shape) {
    case "diamond":
      return (
        <polygon
          points={`${String(x)},${String(top)} ${String(left + width)},${String(y)} ${String(x)},${String(top + height)} ${String(left)},${String(y)}`}
        />
      );
    case "stadium":
      return <rect x={left} y={top} width={width} height={height} rx={height / 2} />;
    case "round":
      return <rect x={left} y={top} width={width} height={height} rx="12" />;
    case "rect":
      return <rect x={left} y={top} width={width} height={height} rx="3" />;
  }
}

interface TextLinesProps {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
}

/** 複数行の文字を (x, y) を中心に並べる。 */
function TextLines({ lines, x, y, fontSize, lineHeight }: TextLinesProps): JSX.Element {
  const first = y - ((lines.length - 1) * lineHeight) / 2;
  // 同じ文字の行もありうるので、行の key には文字ではなく行ごとに違う高さを使う
  const rows = lines.map((line, i) => ({ line, top: first + i * lineHeight }));
  return (
    <text x={x} fontSize={fontSize} textAnchor="middle" dominantBaseline="central">
      {rows.map(({ line, top }) => (
        <tspan key={top} x={x} y={top}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * 文字の幅を、本文と同じフォントで測る関数。図は 16px で組んで em で伸び縮みさせるので、16px で測れば足りる。
 * キャンバスのない環境（テストの jsdom）では見積もりで代える。
 */
function measureText(): MeasureText {
  if (typeof OffscreenCanvas === "undefined") {
    return estimateTextWidth;
  }
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (context === null) {
    return estimateTextWidth;
  }
  const family = getComputedStyle(document.body).fontFamily;
  return (text, fontSize) => {
    context.font = `${String(fontSize)}px ${family}`;
    return context.measureText(text).width;
  };
}
