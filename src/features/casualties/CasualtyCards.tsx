// 負傷者のカード。物 1 つにつき 1 枚。残り時間と効能は Readout の部品だけが 1 s ごとに描き直す。
import { LineChartIcon } from "lucide-react";
import { lazy, memo, Suspense, useMemo, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  activeTourniquets,
  ammoniumTimes,
  lastDoseAtMs,
  lastSalineAtMs,
} from "@/features/casualties/casualty-view";
import { useClock } from "@/features/casualties/clock";
import { primaryText, secondaryTexts } from "@/features/casualties/drug-display";
import { drugTimers, effectAt, type DrugForecast } from "@/features/casualties/forecast";
import { overdoseTimer, type OverdoseTimer } from "@/features/casualties/overdose";
import {
  chartStartMs,
  forecastChartData,
  forecastChartSpec,
} from "@/features/casualties/casualty-chart";
import {
  DRUG_LABELS,
  formatClock,
  formatDuration,
  SITE_LABELS,
} from "@/features/casualties/labels";
import { chartSummary } from "@/features/content/chart";
import type { OverdoseLine } from "@/features/medication/overdose-line";
import { singleDosePeak } from "@/features/medication/pharmacology";
import type { DrugId, MedicationFile } from "@/features/medication/schema";
import type { CasualtyRecord } from "@/lib/bindings/CasualtyRecord";

// Recharts は大きいので、カードが出るまで読み込まない（起動を遅くしないため）
const CasualtyChartBody = lazy(() =>
  import("@/features/casualties/CasualtyChartBody").then((m) => ({
    default: m.CasualtyChartBody,
  })),
);

interface TimerProps {
  label: string;
  /** 目標の時刻。null なら「—」 */
  atMs: number | null;
  large?: boolean;
  now: number;
}

/** 毎秒の読み上げが邪魔にならないよう aria-live は切る（カードへ移動すれば数値を読める） */
function Timer({ label, atMs, large = false, now }: TimerProps): JSX.Element {
  return (
    <div role="timer" aria-live="off" className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={large ? "text-2xl font-bold tabular-nums" : "text-sm tabular-nums"}>
        {atMs === null ? "—" : formatDuration(atMs - now)}
      </span>
    </div>
  );
}

function ElapsedSince({ label, sinceMs }: { label: string; sinceMs: number }): JSX.Element {
  const now = useClock();
  return (
    <div role="timer" aria-live="off" className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{formatDuration(now - sinceMs)}</span>
    </div>
  );
}

function OverdoseRow({ timer, now }: { timer: OverdoseTimer; now: number }): JSX.Element | null {
  switch (timer.kind) {
    case "none":
      return null;
    case "danger":
      return <p className="m-0 text-sm font-medium text-destructive">1 本でも危険</p>;
    case "limit": {
      const label = `${String(timer.doses)} 本まで OK`;
      return timer.safeAtMs > now ? (
        <Timer label={`${label} まで`} atMs={timer.safeAtMs} now={now} />
      ) : (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span>OK</span>
        </div>
      );
    }
  }
}

function DrugReadout({
  medication,
  forecast,
  overdose,
}: {
  medication: MedicationFile;
  forecast: DrugForecast;
  overdose: OverdoseTimer;
}): JSX.Element {
  const now = useClock();
  const timers = drugTimers(forecast, now);
  const { drug, doses } = forecast;
  const value = Math.abs(effectAt(medication, drug, doses, now));
  const percent = (value / singleDosePeak(medication, drug)) * 100;
  const secondary = secondaryTexts(medication, drug, doses, now);
  return (
    <>
      <p className="font-semibold tabular-nums">{primaryText(medication, drug, doses, now)}</p>
      <Progress
        value={Math.min(100, percent)}
        aria-label={`${DRUG_LABELS[drug]}の効能（1 本のピークを 100 とする）`}
      />
      {secondary.length > 0 && (
        <p className="text-sm text-muted-foreground tabular-nums">{secondary.join(" / ")}</p>
      )}
      {timers.focus === "peak" ? (
        <Timer label="ピークまで" atMs={timers.nextPeakAtMs} large now={now} />
      ) : (
        <Timer label="半分まで" atMs={timers.halfAtMs} large={timers.focus === "half"} now={now} />
      )}
      <Timer
        label="消えるまで"
        atMs={timers.clearAtMs}
        large={timers.focus === "clear"}
        now={now}
      />
      <OverdoseRow timer={overdose} now={now} />
    </>
  );
}

interface ChartPreviewProps {
  forecast: DrugForecast;
  onOpen: (drug: DrugId) => void;
}

/** 小さなグラフ。線は記録が変わったときだけ描き直す。 */
const ChartPreview = memo(function ChartPreview({ forecast, onOpen }: ChartPreviewProps) {
  const forecasts = useMemo(() => [forecast], [forecast]);
  const data = useMemo(() => forecastChartData(forecasts), [forecasts]);
  const spec = useMemo(() => forecastChartSpec(forecasts), [forecasts]);
  const label = DRUG_LABELS[forecast.drug];
  return (
    <Button
      variant="ghost"
      className="relative h-auto w-full flex-col items-stretch p-1"
      aria-label={`${label}の大きなグラフを開く。${chartSummary(data)}`}
      onClick={() => {
        onOpen(forecast.drug);
      }}
    >
      <Suspense fallback={<Skeleton className="h-14 w-full" />}>
        <CasualtyChartBody spec={spec} data={data} compact startMs={null} />
      </Suspense>
      <LineChartIcon
        className="absolute top-1 right-1 size-3.5 text-muted-foreground"
        aria-hidden
      />
    </Button>
  );
});

interface DrugCardProps {
  medication: MedicationFile;
  forecast: DrugForecast;
  overdoseLine: OverdoseLine;
  inPain: boolean;
  onOpenChart: (drug: DrugId) => void;
}

const DrugCard = memo(function DrugCard({
  medication,
  forecast,
  overdoseLine,
  inPain,
  onOpenChart,
}: DrugCardProps) {
  // モルヒネは数千秒を探すので、毎秒の描き直しでは計算せず、記録かトグルが変わったときだけにする
  const overdose = useMemo(
    () => overdoseTimer(medication, forecast.drug, forecast.doses, overdoseLine, inPain),
    [medication, forecast, overdoseLine, inPain],
  );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h3>{DRUG_LABELS[forecast.drug]}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <DrugReadout medication={medication} forecast={forecast} overdose={overdose} />
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground">打った本数</span>
          <span className="tabular-nums">{forecast.doseCount} 本</span>
        </div>
        <ElapsedSince label="最後に打ってから" sinceMs={forecast.lastAtMs} />
        <ChartPreview forecast={forecast} onOpen={onOpenChart} />
      </CardContent>
    </Card>
  );
});

function SalineReadout({ endsAtMs, seconds }: { endsAtMs: number; seconds: number }): JSX.Element {
  const now = useClock();
  const done = 100 - ((endsAtMs - now) / (seconds * 1000)) * 100;
  return (
    <>
      <Timer label="入れ終わるまで" atMs={endsAtMs} large now={now} />
      <Progress value={Math.min(100, Math.max(0, done))} aria-label="生理食塩水の進み具合" />
    </>
  );
}

function SimpleCard({ title, children }: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

/** Circulation なしの「次を打てるまで」。濃度の仕組みがないので、残り時間だけを出す */
function CoreLockCard({ title, untilMs }: { title: string; untilMs: number }): JSX.Element {
  const now = useClock();
  return (
    <SimpleCard title={title}>
      <Timer label="次を打てるまで" atMs={untilMs} large now={now} />
    </SimpleCard>
  );
}

const CARD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3";

interface CasualtyCardsProps {
  medication: MedicationFile;
  records: readonly CasualtyRecord[];
  forecasts: readonly DrugForecast[];
  circulation: boolean;
  overdoseLine: OverdoseLine;
  inPain: boolean;
  onOpenChart: (drug: DrugId) => void;
}

/** 体内から消えた薬、入れ終わった生理食塩水、外した止血帯のカードは閉じる。記録は履歴に残る。 */
export function CasualtyCards({
  medication,
  records,
  forecasts,
  circulation,
  overdoseLine,
  inPain,
  onOpenChart,
}: CasualtyCardsProps): JSX.Element {
  const now = useClock();
  const salineAtMs = lastSalineAtMs(records);
  const salineEndsAtMs = salineAtMs === null ? null : salineAtMs + medication.salineSeconds * 1000;
  const locks = (["epinephrine", "morphine"] as const).flatMap((drug) => {
    const at = lastDoseAtMs(records, drug);
    const untilMs = at === null ? 0 : at + medication.coreLockSeconds[drug] * 1000;
    return untilMs > now ? [{ drug, untilMs }] : [];
  });
  const ammonium = circulation ? ammoniumTimes(records) : [];
  const open = circulation ? forecasts.filter((f) => f.clearAtMs > now) : [];
  // 今閉じたカードを読み上げる。状態に持たず時刻から決めるので、開き直しても前の知らせを繰り返さない
  const justClosed = forecasts.filter((f) => f.clearAtMs <= now && now - f.clearAtMs < 10_000);

  return (
    <>
      <p role="status" className="sr-only">
        {circulation &&
          justClosed.map((f) => `${DRUG_LABELS[f.drug]}が体内から消えました。`).join("")}
      </p>
      <div className={CARD_GRID}>
        {open.map((forecast) => (
          <DrugCard
            key={forecast.drug}
            medication={medication}
            forecast={forecast}
            overdoseLine={overdoseLine}
            inPain={inPain}
            onOpenChart={onOpenChart}
          />
        ))}
        {!circulation &&
          locks.map(({ drug, untilMs }) => (
            <CoreLockCard key={drug} title={DRUG_LABELS[drug]} untilMs={untilMs} />
          ))}
        {salineEndsAtMs !== null && salineEndsAtMs > now && (
          <SimpleCard title="生理食塩水">
            <SalineReadout endsAtMs={salineEndsAtMs} seconds={medication.salineSeconds} />
          </SimpleCard>
        )}
        {activeTourniquets(records).map(({ site, sinceMs }) => (
          <SimpleCard key={site} title={`止血帯（${SITE_LABELS[site]}）`}>
            <ElapsedSince label="巻いてから" sinceMs={sinceMs} />
          </SimpleCard>
        ))}
        {ammonium.length > 0 && (
          <SimpleCard title={DRUG_LABELS.ammonium_carbonate}>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm tabular-nums">
              {ammonium.map((at) => (
                <li key={at}>{formatClock(at)}</li>
              ))}
            </ul>
          </SimpleCard>
        )}
      </div>
    </>
  );
}

interface ChartDialogBodyProps {
  forecasts: readonly DrugForecast[];
}

/** 大きなグラフの中身。ダイアログを開いたときだけ描く。 */
export function CasualtyChartView({ forecasts }: ChartDialogBodyProps): JSX.Element {
  const data = useMemo(() => forecastChartData(forecasts), [forecasts]);
  const spec = useMemo(() => forecastChartSpec(forecasts), [forecasts]);
  const startMs = useMemo(() => chartStartMs(forecasts), [forecasts]);
  return (
    <figure className="m-0 w-full">
      <Suspense fallback={<Skeleton className="h-44 w-full" />}>
        <CasualtyChartBody spec={spec} data={data} compact={false} startMs={startMs} />
      </Suspense>
    </figure>
  );
}
