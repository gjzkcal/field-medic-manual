import { cn } from "cn";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CornerDownLeftIcon,
  OctagonAlertIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type JSX, type RefObject } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { daysSinceVerified, isStale } from "@/features/library/stale";
import { hasModifier, isActivatable, isTextEntry } from "@/features/triage/keyboard";
import {
  formatPath,
  type FlowLookup,
  type RunnerOption,
  type RunnerState,
} from "@/features/triage/runner";
import type { Flow, Outcome } from "@/features/triage/schema";
import { useTriageRunner } from "@/features/triage/use-triage-runner";
import { CountdownTimer } from "@/features/triage/view/CountdownTimer";
import { FlowLinks } from "@/features/triage/view/FlowLinks";
import { OUTCOME_CLASSES, OUTCOME_LABELS, TONE_CLASSES } from "@/features/triage/view/tone";
import { TrailNav } from "@/features/triage/view/TrailNav";
import { useNow } from "@/hooks/use-now";

/** キーで選べる選択肢の数（triage-format.md §3 の V3 の上限と同じ） */
const MAX_KEY_CHOICES = 4;

interface FlowRunnerProps {
  root: Flow;
  lookup: FlowLookup;
}

/**
 * フローの実行画面の本体。ページの枠に依存しないので、Step 08 の小窓（幅 420px）にもそのまま置ける。
 * 1 列に並べ、幅が狭くても崩れないようにしている。
 */
export function FlowRunner({ root, lookup }: FlowRunnerProps): JSX.Element {
  const { state, choose, back, restart, jumpTo } = useTriageRunner(root, lookup);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pathKey = formatPath(state.path);

  // 進むたびに質問へフォーカスを移す。押したボタンにフォーカスが残ると、次の画面で Enter がそのボタンに当たるため
  useEffect(() => {
    headingRef.current?.focus();
  }, [root.id, pathKey]);

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      hasModifier(event) ||
      isTextEntry(event.target)
    ) {
      return;
    }
    const digit = /^[1-9]$/.test(event.key) ? Number(event.key) : null;
    if (digit !== null && digit <= MAX_KEY_CHOICES) {
      if (digit <= state.options.length) {
        event.preventDefault();
        choose(digit - 1);
      }
      return;
    }
    switch (event.key) {
      case "Enter":
        // 「次へ」（action）と「元のフローへ戻る」のとき。質問では押し間違いを防ぐため数字で選ばせる。
        // ボタンの上ではブラウザがクリックにするので任せる
        if (isActivatable(event.target)) {
          return;
        }
        if (state.node.type === "action" || state.options.length === 1) {
          event.preventDefault();
          choose(0);
        } else if (state.options.length === 0) {
          event.preventDefault();
          restart();
        }
        return;
      case "Backspace":
        if (state.path.length > 0) {
          event.preventDefault();
          back();
        }
        return;
      case "Escape":
        if (state.path.length > 0) {
          event.preventDefault();
          restart();
        }
        return;
      default:
        // ほかのキーはページのほかの部品（上部の検索欄の Ctrl+K など）に任せる
        return;
    }
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      handleKeyDown(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const now = useNow();
  const staleFlow = [root, state.flow].find((f) => isStale(f.verifiedAt ?? null, now));
  const atStart = state.path.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{root.title}</h1>
        {state.depth > 0 && (
          <Badge variant="secondary">
            <CornerDownLeftIcon className="rotate-90" />
            {state.flow.title}
          </Badge>
        )}
      </div>

      {staleFlow !== undefined && <StaleAlert flow={staleFlow} now={now} />}

      {state.trail.length > 0 && <TrailNav trail={state.trail} onJump={jumpTo} />}

      <NodeView
        key={`${root.id}:${pathKey}`}
        state={state}
        lookup={lookup}
        headingRef={headingRef}
        onChoose={choose}
        onRestart={restart}
      />

      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button variant="outline" onClick={back} disabled={atStart}>
          <Undo2Icon />
          戻る
          <Kbd>Backspace</Kbd>
        </Button>
        <Button variant="outline" onClick={restart} disabled={atStart}>
          <RotateCcwIcon />
          最初から
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}

function StaleAlert({ flow, now }: { flow: Flow; now: Date }): JSX.Element {
  const verifiedAt = flow.verifiedAt ?? null;
  const days = verifiedAt === null ? null : daysSinceVerified(verifiedAt, now);
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>内容が古い可能性があります</AlertTitle>
      <AlertDescription>
        {days === null
          ? `「${flow.title}」には確認日が書かれていません。`
          : `「${flow.title}」は ${String(days)} 日前（${verifiedAt ?? ""}）に確認した内容です。`}
        ACE Medical の更新で、ゲームの仕様と違っていることがあります。
      </AlertDescription>
    </Alert>
  );
}

interface NodeViewProps {
  state: RunnerState;
  lookup: FlowLookup;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onChoose: (index: number) => void;
  onRestart: () => void;
}

function NodeView({ state, lookup, headingRef, onChoose, onRestart }: NodeViewProps): JSX.Element {
  const { node, options } = state;
  const heading = (
    <h2
      ref={headingRef}
      tabIndex={-1}
      className="text-2xl leading-snug font-bold outline-none sm:text-3xl"
    >
      {node.text}
    </h2>
  );

  switch (node.type) {
    case "question":
      return (
        <section className="flex flex-col gap-4">
          {heading}
          {node.help !== undefined && <HelpText help={node.help} />}
          <ChoiceButtons options={options} onChoose={onChoose} />
        </section>
      );
    case "action":
      return (
        <section className="flex flex-col gap-4">
          <Badge variant="outline" className="w-fit">
            処置
          </Badge>
          {heading}
          {node.items !== undefined && node.items.length > 0 && (
            <ul aria-label="使う物品" className="flex flex-wrap gap-1.5">
              {node.items.map((item) => (
                <li key={item}>
                  <Badge variant="secondary" className="h-7 px-3 text-sm">
                    {item}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {node.timerSec !== undefined && <CountdownTimer seconds={node.timerSec} />}
          {node.help !== undefined && <HelpText help={node.help} />}
          {node.links !== undefined && <FlowLinks links={node.links} lookup={lookup} />}
          <ChoiceButtons options={options} onChoose={onChoose} primary />
        </section>
      );
    case "end":
      return (
        <section className="flex flex-col gap-4">
          <div
            className={cn(
              "flex flex-col gap-2 rounded-xl border-2 p-4",
              OUTCOME_CLASSES[node.outcome],
            )}
          >
            <p className="flex items-center gap-2 font-semibold">
              <OutcomeIcon outcome={node.outcome} />
              {OUTCOME_LABELS[node.outcome]}
            </p>
            <div className="text-foreground">{heading}</div>
          </div>
          {node.help !== undefined && <HelpText help={node.help} />}
          {node.links !== undefined && <FlowLinks links={node.links} lookup={lookup} />}
          {options.length > 0 ? (
            <ChoiceButtons options={options} onChoose={onChoose} primary />
          ) : (
            <Button size="lg" className="h-14 text-lg" onClick={onRestart}>
              <RotateCcwIcon />
              最初から
              <Kbd>Enter</Kbd>
            </Button>
          )}
        </section>
      );
  }
}

interface ChoiceButtonsProps {
  options: readonly RunnerOption[];
  onChoose: (index: number) => void;
  /**
   * 先頭（「次へ」「元のフローへ戻る」）を塗りつぶしのボタンにし、押す場所がすぐ分かるようにする。
   * 2 番目以降（「〇〇を持っていない」）は枠だけにして、先頭と見分けられるようにする
   */
  primary?: boolean;
}

function ChoiceButtons({ options, onChoose, primary = false }: ChoiceButtonsProps): JSX.Element {
  return (
    <div className="grid gap-3">
      {options.map((option, i) => {
        const filled = primary && i === 0;
        return (
          <Button
            key={`${String(i)}:${option.label}`}
            variant={filled ? "default" : "outline"}
            className={cn(
              "h-auto min-h-14 justify-start gap-3 px-4 py-3 text-left text-lg whitespace-normal",
              option.tone !== null && !filled && TONE_CLASSES[option.tone],
            )}
            onClick={() => {
              onChoose(i);
            }}
          >
            <Kbd className="h-6 min-w-6 text-sm">{i + 1}</Kbd>
            <span className="flex-1">{option.label}</span>
            {filled && <ChevronRightIcon />}
          </Button>
        );
      })}
    </div>
  );
}

function HelpText({ help }: { help: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" />}
      >
        <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
        補足
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{help}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OutcomeIcon({ outcome }: { outcome: Outcome }): JSX.Element {
  switch (outcome) {
    case "ok":
      return <CircleCheckIcon aria-hidden className="size-5" />;
    case "warn":
      return <TriangleAlertIcon aria-hidden className="size-5" />;
    case "critical":
      return <OctagonAlertIcon aria-hidden className="size-5" />;
  }
}
