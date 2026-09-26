import { ChevronRightIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import type { TrailStep } from "@/features/triage/runner";

/** 畳んだときに出す、直近の歩の数 */
const RECENT_STEPS = 3;

interface TrailNavProps {
  trail: readonly TrailStep[];
  /** k 番目の歩のノードに戻る */
  onJump: (step: number) => void;
}

/**
 * たどった経路（パンくず）。押すとそのノードまで戻る。
 * 長くなると小窓（幅 420px）で質問が画面の下へ押し出されるので、古い歩は畳んで直近だけを出す。
 */
export function TrailNav({ trail, onJump }: TrailNavProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // 1 歩だけ畳んでも短くならないので、畳むのは 2 歩以上隠れるときだけ
  const hidden = expanded || trail.length <= RECENT_STEPS + 1 ? 0 : trail.length - RECENT_STEPS;
  return (
    <nav aria-label="たどった経路">
      <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-sm">
        {hidden > 0 && (
          <li>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0.5 text-muted-foreground"
              onClick={() => {
                setExpanded(true);
              }}
            >
              …ほか {hidden} 歩
            </Button>
          </li>
        )}
        {trail.map((step, i) =>
          i < hidden ? null : (
            <li
              key={`${String(i)}:${step.flowId}:${step.nodeId}`}
              className="flex min-w-0 items-center gap-0.5"
            >
              {i > 0 && (
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-auto max-w-64 min-w-0 py-0.5 text-left whitespace-normal"
                title={`${step.text}（${step.answer}）に戻る`}
                onClick={() => {
                  onJump(i);
                }}
              >
                <span className="line-clamp-1 min-w-0 text-muted-foreground">
                  {step.depth > 0 && <span aria-label="サブフロー">↳ </span>}
                  {step.text}
                </span>
                <span className="shrink-0 font-medium">{step.answer}</span>
              </Button>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
