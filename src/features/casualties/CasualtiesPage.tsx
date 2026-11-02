// 負傷者の記録。メイン・小窓・Web 版で同じ画面を使う。
import { ChevronDownIcon, PlusIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";

import { usePageTitle } from "@/app/use-page-title";
import { IssueCard } from "@/components/IssueCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { CasualtyCards, CasualtyChartView } from "@/features/casualties/CasualtyCards";
import {
  applyCasualtyOp,
  loadCasualties,
  useCasualties,
} from "@/features/casualties/casualty-store";
import { activeTourniquets, dosesOf, nextCasualtyName } from "@/features/casualties/casualty-view";
import { setClockPaused } from "@/features/casualties/clock";
import { buildForecasts } from "@/features/casualties/forecast";
import {
  CORE_DRUGS,
  DRUG_LABELS,
  DRUG_ORDER,
  entryLabel,
  formatClock,
  SITE_LABELS,
  SITES,
} from "@/features/casualties/labels";
import { overdoseLimit } from "@/features/casualties/overdose";
import { OverdoseLineToggle } from "@/features/casualties/OverdoseLineToggle";
import { loadMedication } from "@/features/medication/bundle";
import type { OverdoseLine } from "@/features/medication/overdose-line";
import { DRUG_IDS, type DrugId, type MedicationFile } from "@/features/medication/schema";
import { activeMods, useModSettings } from "@/features/settings/mod-settings";
import { useViewerSettings } from "@/features/settings/viewer-settings";
import { modsActive } from "@/features/triage/runner";
import type { Casualty } from "@/lib/bindings/Casualty";
import type { CasualtyEntry } from "@/lib/bindings/CasualtyEntry";
import { IS_WEB } from "@/lib/platform";
import { errorMessage } from "@/lib/tauri";

const NAME_MAX = 40;
const NOTE_MAX = 100;
// 記録のボタンはプレイ中に素早く押すので、指やマウスで外しにくい大きさ（44 px）にし、幅をそろえて並べる
const RECORD_BUTTON = "h-11 text-sm";
const RECORD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(8.5rem,100%),1fr))] gap-2";
// 小窓は既定の幅で 3 列にする。ボタンの高さは変えず、列を増やして 1 枚目のカードを画面に収める
const COMPACT_RECORD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(7rem,100%),1fr))] gap-2";
const NOTICE_LEAD = "目安です。ゲームの診察を優先してください。";

type MedicationLoad =
  | { status: "loading" }
  | { status: "ready"; medication: MedicationFile }
  | { status: "error"; message: string };

function useMedication(): MedicationLoad {
  const [load, setLoad] = useState<MedicationLoad>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadMedication().then(
      (medication) => {
        if (!cancelled) {
          setLoad({ status: "ready", medication });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: errorMessage(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return load;
}

function NoticeList({ circulation }: { circulation: boolean }): JSX.Element {
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
      <li>AI や仲間が打った分は入りません。</li>
      <li>記録を押す時刻は、実際に打った時刻と数秒ずれます。</li>
      <li>人の多いサーバーでは、全体が 1〜2 割遅く進むことがあります。</li>
      {circulation && (
        <>
          <li>ミッションの設定で薬の数値を変えたサーバーでは、ずれます。</li>
          <li>
            タイマーとバーは効能が基準です（1 本のピークを 100
            とします）。マニュアルの濃度の時刻とは違うことがあります。
          </li>
          <li>
            「N 本まで OK まで」は、何も打っていないときと同じ本数を同時に打てるまでの時間です。血液
            100% で、薬の組み合わせ（エピネフリンとフェニレフリンなど）と血液の減りは含みません。10
            s 長めに出します。
          </li>
          <li>痛み・気胸ありは、痛みがあってもなくても大丈夫な本数で出します。</li>
        </>
      )}
      <li>
        {IS_WEB
          ? "記録はこのブラウザにだけ残ります。「全部消す」で消せます。"
          : "トレイにしまっても記録は残ります。アプリを終了すると消えます。"}
      </li>
    </ul>
  );
}

function Notice({ circulation }: { circulation: boolean }): JSX.Element {
  return (
    <Collapsible>
      <p className="m-0 text-sm font-medium">{NOTICE_LEAD}</p>
      <CollapsibleTrigger
        render={<Button variant="link" size="sm" className="h-auto px-0" />}
        className="group/notice"
      >
        計算の前提
        <ChevronDownIcon className="transition-transform group-data-panel-open/notice:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <NoticeList circulation={circulation} />
      </CollapsibleContent>
    </Collapsible>
  );
}

interface CompactNoticeProps {
  circulation: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

/** 小窓の注意書き。プレイ中に毎回は使わない操作もここへ畳み、カードの場所を空ける */
function CompactNotice({
  circulation,
  open,
  onOpenChange,
  triggerRef,
  children,
}: CompactNoticeProps): JSX.Element {
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className="m-0 text-sm font-medium">{NOTICE_LEAD}</p>
        <CollapsibleTrigger
          render={<Button ref={triggerRef} variant="link" size="sm" className="h-auto px-0" />}
          className="group/notice"
        >
          前提と操作
          <ChevronDownIcon className="transition-transform group-data-panel-open/notice:rotate-180" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 pt-2">
          {children}
          <NoticeList circulation={circulation} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** 記録を消す操作は押し間違えると戻せないので、確かめてから行う */
function ConfirmButton({
  title,
  description,
  confirmLabel,
  triggerLabel,
  disabled = false,
  onConfirm,
}: ConfirmDialogProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Trash2Icon />
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>キャンセル</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RemoveCasualtyButton({
  casualty,
  onAnnounce,
}: {
  casualty: Casualty;
  onAnnounce: (message: string) => void;
}): JSX.Element {
  return (
    <ConfirmButton
      title={`${casualty.name}を消しますか？`}
      description="この負傷者の記録もすべて消えます。元に戻せません。"
      confirmLabel="消す"
      triggerLabel="この負傷者を消す"
      onConfirm={() => {
        void applyCasualtyOp({ op: "remove_casualty", casualtyId: casualty.id });
        onAnnounce(`${casualty.name}を消しました`);
      }}
    />
  );
}

interface RecordControlsProps {
  casualty: Casualty;
  circulation: boolean;
  compact: boolean;
  onRecord: (entry: CasualtyEntry) => void;
  onUndoLast: () => void;
}

function RecordControls({
  casualty,
  circulation,
  compact,
  onRecord,
  onUndoLast,
}: RecordControlsProps): JSX.Element {
  const [note, setNote] = useState("");
  const drugs = circulation ? DRUG_ORDER : CORE_DRUGS;
  const applied = new Set(activeTourniquets(casualty.records).map((t) => t.site));

  function submitNote(event: SyntheticEvent): void {
    event.preventDefault();
    const text = note.trim();
    if (text !== "") {
      onRecord({ kind: "note", text });
      setNote("");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="薬と生理食塩水を記録する"
        className={compact ? COMPACT_RECORD_GRID : RECORD_GRID}
      >
        {drugs.map((drug) => (
          <Button
            key={drug}
            variant="outline"
            className={RECORD_BUTTON}
            onClick={() => {
              onRecord({ kind: "drug", drug });
            }}
          >
            {DRUG_LABELS[drug]}
          </Button>
        ))}
        <Button
          variant="outline"
          className={RECORD_BUTTON}
          onClick={() => {
            onRecord({ kind: "saline" });
          }}
        >
          生理食塩水
        </Button>
      </div>
      <div
        role="group"
        aria-label="止血帯を記録する"
        className={compact ? "grid grid-cols-5 items-center gap-2" : "grid grid-cols-4 gap-2"}
      >
        <span
          className={
            compact
              ? "text-sm text-muted-foreground"
              : "col-span-full text-sm text-muted-foreground"
          }
        >
          止血帯
        </span>
        {SITES.map((site) => (
          <Toggle
            key={site}
            variant="outline"
            className={RECORD_BUTTON}
            pressed={applied.has(site)}
            aria-label={`${SITE_LABELS[site]}の止血帯`}
            onPressedChange={(pressed) => {
              onRecord({ kind: pressed ? "tourniquet_on" : "tourniquet_off", site });
            }}
          >
            {SITE_LABELS[site]}
          </Toggle>
        ))}
      </div>
      <div className={compact ? "flex items-center gap-1.5" : "flex flex-col items-start gap-2"}>
        <form onSubmit={submitNote} className="flex w-full min-w-0 items-center gap-1.5">
          <Input
            aria-label="メモ"
            placeholder="メモ"
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <Button type="submit" variant="outline" size="sm" disabled={note.trim() === ""}>
            残す
          </Button>
        </form>
        <Button
          variant="ghost"
          size="sm"
          aria-label="直前の記録を取り消す"
          disabled={casualty.records.length === 0}
          onClick={onUndoLast}
        >
          <Undo2Icon />
          {compact ? "取り消す" : "直前の記録を取り消す"}
        </Button>
      </div>
    </div>
  );
}

function History({
  casualty,
  onRemove,
}: {
  casualty: Casualty;
  onRemove: (recordId: string, label: string) => void;
}): JSX.Element | null {
  if (casualty.records.length === 0) {
    return null;
  }
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />} className="group/history">
        記録（{casualty.records.length} 件）
        <ChevronDownIcon className="transition-transform group-data-panel-open/history:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {casualty.records.toReversed().map((record) => {
            const label = entryLabel(record.entry);
            return (
              <li key={record.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">
                  <span className="mr-2 text-muted-foreground tabular-nums">
                    {formatClock(record.atMs)}
                  </span>
                  {label}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${formatClock(record.atMs)} の${label}を取り消す`}
                  onClick={() => {
                    onRemove(record.id, label);
                  }}
                >
                  取り消す
                </Button>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface OverdoseBandProps {
  casualty: Casualty;
  medication: MedicationFile;
  overdoseLine: OverdoseLine;
}

/** カードの上の帯。「N 本まで OK まで」の前提（痛み・気胸と、危ない線）を切り替える */
function OverdoseBand({ casualty, medication, overdoseLine }: OverdoseBandProps): JSX.Element {
  // まだ打っていない薬でも、1 本で危ないなら打つ前に気づけるよう帯に書く
  const dangerous = DRUG_IDS.filter(
    (drug) => overdoseLimit(medication, drug, overdoseLine, casualty.inPain).kind === "danger",
  );
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={casualty.inPain}
            onCheckedChange={(checked) => {
              void applyCasualtyOp({ op: "set_pain", casualtyId: casualty.id, inPain: checked });
            }}
          />
          痛み・気胸あり
        </label>
        <OverdoseLineToggle />
      </div>
      {dangerous.length > 0 && (
        <p className="m-0 text-sm font-medium text-destructive">
          {dangerous.map((drug) => DRUG_LABELS[drug]).join("・")}は 1 本でも危険です。
        </p>
      )}
    </div>
  );
}

interface CasualtyPanelProps {
  casualty: Casualty;
  medication: MedicationFile;
  circulation: boolean;
  compact: boolean;
  onAnnounce: (message: string) => void;
}

function CasualtyPanel({
  casualty,
  medication,
  circulation,
  compact,
  onAnnounce,
}: CasualtyPanelProps): JSX.Element {
  const { records } = casualty;
  const forecasts = useMemo(
    () => buildForecasts(medication, dosesOf(records)),
    [medication, records],
  );
  const [chartDrugs, setChartDrugs] = useState<readonly DrugId[]>([]);
  const shownForecasts = forecasts.filter((f) => chartDrugs.includes(f.drug));
  const overdoseLine = useViewerSettings((s) => s.settings.overdoseLine);

  function record(entry: CasualtyEntry): void {
    void applyCasualtyOp({ op: "add_record", casualtyId: casualty.id, entry });
    onAnnounce(`${entryLabel(entry)}を記録しました`);
  }

  function removeRecord(recordId: string, label: string): void {
    void applyCasualtyOp({ op: "remove_record", casualtyId: casualty.id, recordId });
    onAnnounce(`${label}の記録を取り消しました`);
  }

  const last = records.at(-1);

  return (
    <div className="flex flex-col gap-3">
      {compact ? (
        <h2 className="sr-only">{casualty.name}</h2>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{casualty.name}</h2>
          <RemoveCasualtyButton casualty={casualty} onAnnounce={onAnnounce} />
        </div>
      )}
      <RecordControls
        casualty={casualty}
        circulation={circulation}
        compact={compact}
        onRecord={record}
        onUndoLast={() => {
          if (last !== undefined) {
            removeRecord(last.id, entryLabel(last.entry));
          }
        }}
      />
      {circulation && (
        <OverdoseBand casualty={casualty} medication={medication} overdoseLine={overdoseLine} />
      )}
      <CasualtyCards
        medication={medication}
        records={records}
        forecasts={forecasts}
        circulation={circulation}
        overdoseLine={overdoseLine}
        inPain={casualty.inPain}
        onOpenChart={(drug) => {
          setChartDrugs([drug]);
        }}
      />
      <History casualty={casualty} onRemove={removeRecord} />
      <Dialog
        open={shownForecasts.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setChartDrugs([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>効能の推移（{casualty.name}）</DialogTitle>
            <DialogDescription>
              1 本のピークを 100 とした効能です。点線は 50%、縦線は今です。
            </DialogDescription>
          </DialogHeader>
          <div role="group" aria-label="重ねて見る薬" className="flex flex-wrap gap-1.5">
            {forecasts.map(({ drug }) => (
              <Toggle
                key={drug}
                variant="outline"
                size="sm"
                pressed={chartDrugs.includes(drug)}
                onPressedChange={(pressed) => {
                  setChartDrugs((current) =>
                    pressed ? [...current, drug] : current.filter((d) => d !== drug),
                  );
                }}
              >
                {DRUG_LABELS[drug]}
              </Toggle>
            ))}
          </div>
          {shownForecasts.length > 0 && <CasualtyChartView forecasts={shownForecasts} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddCasualtyForm({ onAdded }: { onAdded: (id: string | null) => void }): JSX.Element {
  const [name, setName] = useState("");
  const casualties = useCasualties((s) => s.casualties);

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    const op = {
      op: "add_casualty",
      name: trimmed === "" ? nextCasualtyName(casualties.map((c) => c.name)) : trimmed,
    } as const;
    setName("");
    void applyCasualtyOp(op).then(() => {
      onAdded(useCasualties.getState().casualties.at(-1)?.id ?? null);
    });
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1.5">
      <Input
        aria-label="負傷者の名前（入れなくてもかまいません）"
        placeholder="名前（省略可）"
        maxLength={NAME_MAX}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button type="submit" size="sm">
        <PlusIcon />
        足す
      </Button>
    </form>
  );
}

function PageBody({
  medication,
  circulation,
  compact,
}: {
  medication: MedicationFile;
  circulation: boolean;
  compact: boolean;
}): JSX.Element {
  const casualties = useCasualties((s) => s.casualties);
  const error = useCasualties((s) => s.error);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [paused, setPaused] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const selected = casualties.find((c) => c.id === selectedId) ?? casualties[0];

  // 画面を離れた後も止まったままにしない
  useEffect(() => {
    return () => {
      setClockPaused(false);
    };
  }, []);

  function handleAdded(id: string | null): void {
    setSelectedId(id);
    // 1 人目を足すと畳まれて「足す」が消えるので、フォーカスを見失わないよう開閉のボタンへ移す
    if (compact && !toolsOpen) {
      toolsTriggerRef.current?.focus();
    }
  }

  const tools = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <AddCasualtyForm onAdded={handleAdded} />
        <ConfirmButton
          title="全員の記録を消しますか？"
          description="すべての負傷者と記録が消えます。元に戻せません。"
          confirmLabel="全部消す"
          triggerLabel="全部消す"
          disabled={casualties.length === 0}
          onConfirm={() => {
            void applyCasualtyOp({ op: "clear_all" });
            setAnnouncement("全員の記録を消しました");
          }}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={paused}
          onCheckedChange={(checked) => {
            setPaused(checked);
            setClockPaused(checked);
          }}
        />
        残り時間の自動更新を止める
      </label>
    </>
  );

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {compact ? (
        // 誰もいないときは「足す」が要るので、畳まない
        <CompactNotice
          circulation={circulation}
          open={toolsOpen || selected === undefined}
          onOpenChange={setToolsOpen}
          triggerRef={toolsTriggerRef}
        >
          {tools}
          {selected !== undefined && (
            <div>
              <RemoveCasualtyButton casualty={selected} onAnnounce={setAnnouncement} />
            </div>
          )}
        </CompactNotice>
      ) : (
        tools
      )}
      {selected === undefined ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>負傷者はいません</EmptyTitle>
            <EmptyDescription>「足す」を押すと、打った薬や止血帯を記録できます。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs
          value={selected.id}
          onValueChange={(value: string) => {
            setSelectedId(value);
          }}
        >
          <TabsList aria-label="負傷者" className="h-auto w-full flex-wrap justify-start">
            {casualties.map((casualty) => (
              <TabsTrigger key={casualty.id} value={casualty.id} className="flex-none">
                {casualty.name}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={selected.id}>
            <CasualtyPanel
              key={selected.id}
              casualty={selected}
              medication={medication}
              circulation={circulation}
              compact={compact}
              onAnnounce={setAnnouncement}
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

interface CasualtiesPageProps {
  /** 小窓。既定の大きさでカードまで見えるよう、見出しと毎回は使わない操作を畳む */
  compact?: boolean;
}

export function CasualtiesPage({ compact = false }: CasualtiesPageProps): JSX.Element {
  usePageTitle("負傷者");
  const load = useMedication();
  const loaded = useCasualties((s) => s.loaded);
  const modSettings = useModSettings((s) => s.settings);
  const circulation = useMemo(
    () => modsActive(["circulation"], activeMods(modSettings)),
    [modSettings],
  );

  useEffect(() => {
    void loadCasualties();
  }, []);

  const ready = load.status === "ready" && loaded;

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <h1 className={compact ? "sr-only" : "text-2xl font-bold"}>負傷者</h1>
      {!(compact && ready) && <Notice circulation={circulation} />}
      {load.status === "error" && (
        <IssueCard title="薬の数値を読み込めませんでした" detail={load.message} issues={[]} />
      )}
      {(load.status === "loading" || !loaded) && load.status !== "error" && (
        <Skeleton className="h-40 w-full" />
      )}
      {load.status === "ready" && loaded && (
        <PageBody medication={load.medication} circulation={circulation} compact={compact} />
      )}
    </section>
  );
}
