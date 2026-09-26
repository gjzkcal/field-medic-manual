import { PauseIcon, PlayIcon, RotateCcwIcon, TimerIcon } from "lucide-react";
import { cn } from "cn";
import { useEffect, useEffectEvent, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { hasModifier, isActivatable, isTextEntry } from "@/features/triage/keyboard";

/** 残り時間を表示し直す間隔。秒の表示が遅れて見えない程度に細かくする */
const TICK_MS = 200;

type TimerState =
  | { status: "idle" }
  | { status: "running"; endsAt: number }
  | { status: "paused"; remainingMs: number };

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

/**
 * action の timerSec のカウントダウン（CPR のサイクルなど）。勝手に動き出さず、Space か「開始」で始める
 * （処置の準備をしている間に時間が減っていかないため）。ノードが変わったら呼び出し側が key で作り直す。
 */
export function CountdownTimer({ seconds }: { seconds: number }): JSX.Element {
  const [timer, setTimer] = useState<TimerState>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer.status !== "running") {
      return undefined;
    }
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [timer.status]);

  const totalMs = seconds * 1000;
  const remainingMs =
    timer.status === "running"
      ? Math.max(0, timer.endsAt - now)
      : timer.status === "paused"
        ? timer.remainingMs
        : totalMs;
  const finished = remainingMs === 0;

  function toggle(): void {
    const current = Date.now();
    setNow(current);
    setTimer((prev) => {
      switch (prev.status) {
        case "idle":
          return { status: "running", endsAt: current + totalMs };
        case "paused":
          return { status: "running", endsAt: current + prev.remainingMs };
        case "running":
          return { status: "paused", remainingMs: Math.max(0, prev.endsAt - current) };
      }
    });
  }

  function reset(): void {
    setTimer({ status: "idle" });
  }

  // Space で開始・一時停止する（片手で操作できるように）。ボタンの上の Space はそのボタンが受ける
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== " " ||
      event.defaultPrevented ||
      event.isComposing ||
      hasModifier(event) ||
      isTextEntry(event.target) ||
      isActivatable(event.target)
    ) {
      return;
    }
    event.preventDefault();
    toggle();
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

  const running = timer.status === "running" && !finished;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border p-3",
        finished && timer.status !== "idle" && "border-destructive bg-destructive/10",
      )}
    >
      <TimerIcon aria-hidden className="size-5 text-muted-foreground" />
      <span
        role="timer"
        aria-live="off"
        className={cn(
          "text-3xl font-semibold tabular-nums",
          finished && timer.status !== "idle" && "text-destructive",
        )}
      >
        {formatSeconds(Math.ceil(remainingMs / 1000))}
      </span>
      {finished && timer.status !== "idle" && (
        <span className="font-semibold text-destructive" role="status">
          時間です
        </span>
      )}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" onClick={toggle} disabled={finished && timer.status !== "idle"}>
          {running ? <PauseIcon /> : <PlayIcon />}
          {running ? "一時停止" : timer.status === "paused" ? "再開" : "開始"}
          <Kbd>Space</Kbd>
        </Button>
        <Button variant="ghost" onClick={reset} disabled={timer.status === "idle"}>
          <RotateCcwIcon />
          リセット
        </Button>
      </div>
    </div>
  );
}
