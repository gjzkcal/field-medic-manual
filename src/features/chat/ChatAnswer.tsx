import { cn } from "cn";
import {
  BookOpenIcon,
  BrainIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useState, type JSX, type SyntheticEvent } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { Spinner } from "@/components/ui/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { splitFigures } from "@/features/chat/chat-markdown";
import {
  answerForCopy,
  chipLabel,
  citationKey,
  mergeWithMarks,
  turnCitations,
  type AnswerItem,
  type ChatTurn,
  type TextItem,
} from "@/features/chat/chat-turn";
import { ChatMarkdown } from "@/features/chat/ChatMarkdown";
import { FigureEmbed } from "@/features/chat/FigureEmbed";
import { ProposalCard } from "@/features/chat/ProposalCard";
import { useSmoothText } from "@/features/chat/use-smooth-text";
import { internalHref } from "@/features/content/link-target";
import { CopyButton } from "@/features/library/viewer/CopyButton";
import { useOutline } from "@/features/library/viewer/use-doc-data";
import { parseFlowLink } from "@/features/triage/links";
import type { ChatCitation } from "@/lib/bindings/ChatCitation";
import type { ChatNotice } from "@/lib/bindings/ChatNotice";
import type { ChatUsage } from "@/lib/bindings/ChatUsage";
import { errorMessage, openExternal } from "@/lib/tauri";

const NOTICE_TEXT: Record<ChatNotice, string> = {
  web_search_disabled:
    "組織の設定で Web 検索が切られていたので、Web 検索を使わずに答えました（Anthropic の Console で変えられます）",
  tool_limit_reached: "調べる回数の上限に達したので、そこまでに読んだ節で答えました",
  effort_change_unsupported:
    "会話の途中の Effort の変更を API が受け付けなかったので、会話の最初の Effort のまま答えました。変えるには新しい会話にしてください",
};

interface ChatAnswerProps {
  turn: ChatTurn;
  onAnswer: (toolUseId: string, answer: string) => void;
  onDecide: (toolUseId: string, approve: boolean) => void;
}

/** AI の回答。考えている途中・調べた様子・本文・聞き返し・出典・トークン数を、届いた順に出す。 */
export function ChatAnswer({ turn, onAnswer, onDecide }: ChatAnswerProps): JSX.Element {
  const streaming = turn.state === "streaming";
  const groups = groupItems(turn.items);
  const citations = turnCitations(turn);
  const hasText = turn.items.some((i) => i.kind === "text" && i.text !== "");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {groups.map((group) =>
        group.kind === "trace" ? (
          <ActivityTrace key={group.key} items={group.items} streaming={streaming} />
        ) : group.kind === "text" ? (
          <AnswerText key={group.key} items={group.items} streaming={streaming} />
        ) : group.item.kind === "ask" ? (
          <AskUser key={group.key} item={group.item} disabled={!streaming} onAnswer={onAnswer} />
        ) : group.item.kind === "propose" ? (
          <ProposalCard
            key={group.key}
            item={group.item}
            disabled={!streaming}
            onDecide={onDecide}
          />
        ) : null,
      )}
      {streaming && !hasText && (
        <Marker role="status">
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent>回答を作っています</MarkerContent>
        </Marker>
      )}
      {turn.notices.map((notice) => (
        <p key={notice} className="text-xs text-muted-foreground">
          {NOTICE_TEXT[notice]}
        </p>
      ))}
      {turn.message !== null && (
        <p
          role={turn.state === "error" ? "alert" : "status"}
          className={
            turn.state === "error" || turn.state === "refused"
              ? "flex items-start gap-1.5 text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {(turn.state === "error" || turn.state === "refused") && (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          {turn.message}
        </p>
      )}
      {citations.length > 0 && <SourceList citations={citations} />}
      {!streaming && hasText && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>AI の回答です。根拠の節を確かめてください</span>
          {turn.usage !== null && <UsageDetail usage={turn.usage} />}
          <CopyButton
            value={() => answerForCopy(turn)}
            label="回答をコピー"
            doneLabel="回答をコピーしました"
            failLabel="回答をコピーできませんでした"
            icon={<CopyIcon />}
          />
        </div>
      )}
    </div>
  );
}

type Group =
  | { kind: "trace"; key: string; items: AnswerItem[] }
  | { kind: "text"; key: string; items: TextItem[] }
  | { kind: "single"; key: string; item: AnswerItem };

/**
 * 続いて並んだ「考えている途中」と「調べた様子」を 1 つの Trace に、続いて並んだ本文のブロックを 1 つの本文にまとめる
 * （本文の間に細切れに出さないため。API は引用の付いた部分ごとに本文をブロックに分けて返す）。
 */
function groupItems(items: readonly AnswerItem[]): Group[] {
  const groups: Group[] = [];
  for (const [index, item] of items.entries()) {
    const key = `${item.kind}-${String(index)}`;
    if (item.kind === "thinking" || item.kind === "tool") {
      const last = groups.at(-1);
      if (last?.kind === "trace") {
        last.items.push(item);
      } else {
        groups.push({ kind: "trace", key, items: [item] });
      }
    } else if (item.kind === "text") {
      const last = groups.at(-1);
      if (last?.kind === "text") {
        last.items.push(item);
      } else {
        groups.push({ kind: "text", key, items: [item] });
      }
    } else {
      groups.push({ kind: "single", key, item });
    }
  }
  return groups;
}

function ActivityTrace({
  items,
  streaming,
}: {
  items: AnswerItem[];
  streaming: boolean;
}): JSX.Element {
  return (
    <Trace>
      {items.map((item, index) => {
        const key = `${item.kind}-${String(index)}`;
        if (item.kind === "thinking") {
          return (
            <Reasoning
              key={key}
              text={item.text}
              running={streaming && index === items.length - 1}
            />
          );
        }
        if (item.kind === "tool") {
          return <ToolLine key={key} item={item} />;
        }
        return null;
      })}
    </Trace>
  );
}

/** TraceLine の状態。何もないときは props に入れない（status に undefined を渡せないため） */
function lineStatus(running: boolean, failed: boolean): { status?: "running" | "error" } {
  if (running) {
    return { status: "running" };
  }
  return failed ? { status: "error" } : {};
}

/** 考えている途中の要約。考えている間は開き、終わったら閉じる。利用者が開け閉めしたらそれを優先する。 */
function Reasoning({ text, running }: { text: string; running: boolean }): JSX.Element {
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  if (text.trim() === "") {
    return (
      <TraceLine {...lineStatus(running, false)}>
        <TraceIcon>
          <BrainIcon />
        </TraceIcon>
        <TraceTitle>{running ? "考えています" : "考えました"}</TraceTitle>
      </TraceLine>
    );
  }
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine {...lineStatus(running, false)}>
          <TraceIcon>
            <BrainIcon />
          </TraceIcon>
          <TraceTitle>{running ? "考えています" : "考えました"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <p className="text-xs whitespace-pre-wrap text-muted-foreground">{text}</p>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function ToolLine({ item }: { item: Extract<AnswerItem, { kind: "tool" }> }): JSX.Element {
  const running = item.state === "running";
  const failed = item.state === "failed";
  const { icon, title } = toolText(item, running, failed);
  return (
    <TraceLine {...lineStatus(running, failed)}>
      <TraceIcon>{icon}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
    </TraceLine>
  );
}

function toolText(
  item: Extract<AnswerItem, { kind: "tool" }>,
  running: boolean,
  failed: boolean,
): { icon: JSX.Element; title: string } {
  switch (item.tool) {
    case "search_manual":
      return {
        icon: <SearchIcon />,
        title: `${running ? "マニュアルを検索しています" : failed ? "マニュアルを検索できませんでした" : "マニュアルを検索しました"}: ${item.detail}`,
      };
    case "read_section":
      return {
        icon: <BookOpenIcon />,
        title: `${running ? "節を読んでいます" : failed ? "節が見つかりませんでした" : "節を読みました"}: ${sourceLabel(item.detail)}`,
      };
    case "web_search":
      return {
        icon: <GlobeIcon />,
        title: `${running ? "語の意味を Web で調べています" : failed ? "Web で調べられませんでした" : "語の意味を Web で調べました"}${item.detail === "" ? "" : `: ${item.detail}`}`,
      };
    case "casualty_read":
      return {
        icon: <UsersIcon />,
        title: running
          ? "負傷者の記録を読んでいます"
          : failed
            ? "負傷者の記録を読めませんでした"
            : "負傷者の記録を読みました",
      };
  }
}

/** `doc:hemorrhage.md#止血帯を使う` を「止血帯を使う」のように短くする。 */
function sourceLabel(source: string): string {
  const link = parseFlowLink(source);
  if (link?.kind === "doc") {
    return link.anchor ?? link.fileName;
  }
  if (link?.kind === "quickref") {
    return `クイック表（${link.rowId}）`;
  }
  if (link?.kind === "flow") {
    return `フロー（${link.flowId}）`;
  }
  return source;
}

/** まとめた本文。引用の場所ごとに、その場所で引いた出典のチップを文の中に置く。 */
function AnswerText({
  items,
  streaming,
}: {
  items: readonly TextItem[];
  streaming: boolean;
}): JSX.Element {
  const { text, marks } = mergeWithMarks(items);
  const { shown, revealing } = useSmoothText(text, streaming);
  const renderMark = (index: number): JSX.Element | null => {
    const citations = marks[index];
    return citations === undefined ? null : <InlineCitations citations={citations} />;
  };
  return (
    <div className="flex flex-col gap-2">
      {splitFigures(shown).map((part, index) =>
        part.kind === "figure" ? (
          <FigureEmbed key={`figure-${String(index)}`} source={part.source} />
        ) : (
          <ChatMarkdown
            key={`text-${String(index)}`}
            text={part.text}
            streaming={streaming || revealing}
            renderMark={renderMark}
          />
        ),
      )}
    </div>
  );
}

/**
 * 文の中の出典。同じ場所で同じ節を何か所も引いていれば 1 つにまとめ、引いた文を並べる。
 * 名前は節の見出しを短くしたもの（番号だけでは、開くまで何の節か分からないため）。
 */
function InlineCitations({ citations }: { citations: readonly ChatCitation[] }): JSX.Element {
  const groups = new Map<string, { citation: ChatCitation; quotes: string[] }>();
  for (const citation of citations) {
    const key = citationKey(citation);
    const group = groups.get(key) ?? { citation, quotes: [] };
    if (citation.citedText !== "" && !group.quotes.includes(citation.citedText)) {
      group.quotes.push(citation.citedText);
    }
    groups.set(key, group);
  }
  return (
    <>
      {[...groups].map(([key, { citation, quotes }]) => (
        <CitationChip
          key={key}
          citation={citation}
          quotes={quotes}
          label={citation.kind === "manual" ? chipLabel(citation) : hostOf(citation.url)}
          inline
        />
      ))}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 出典のチップ。押すと節（Web の出典は既定のブラウザ）を開き、載せると引いた文を出す。 */
function CitationChip({
  citation,
  quotes,
  label,
  inline = false,
}: {
  citation: ChatCitation;
  /** その場所で引いた文 */
  quotes?: string[];
  label?: string;
  /** 文の中に置く（文字の高さに合わせて小さくする） */
  inline?: boolean;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const open = useOpenCitation(setError);
  const shown = quotes ?? (citation.citedText === "" ? [] : [citation.citedText]);
  const name = label ?? (citation.kind === "manual" ? citation.title : hostOf(citation.url));
  return (
    <>
      <HoverCard>
        <HoverCardTrigger
          delay={10}
          closeDelay={100}
          render={
            <Button
              variant="secondary"
              size="xs"
              className={cn(
                "max-w-full",
                inline && "mx-0.5 h-5 max-w-40 px-1.5 align-text-bottom font-normal",
              )}
              onClick={() => {
                open(citation);
              }}
            />
          }
        >
          {citation.kind === "web" && <GlobeIcon data-icon="inline-start" aria-hidden />}
          <span className="truncate">{name}</span>
        </HoverCardTrigger>
        <HoverCardContent className="flex w-72 flex-col gap-1 text-xs">
          <span className="font-medium">{citation.title}</span>
          {shown.map((quote) => (
            <span key={quote} className="text-muted-foreground">
              「{quote}」
            </span>
          ))}
          {citation.kind === "web" && (
            <span className="text-muted-foreground">
              Web で調べた語の出典（{hostOf(citation.url)}）
            </span>
          )}
        </HoverCardContent>
      </HoverCard>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          出典を開けませんでした: {error}
        </span>
      )}
    </>
  );
}

function useOpenCitation(onError: (message: string) => void): (citation: ChatCitation) => void {
  const outline = useOutline();
  const navigate = useNavigate();
  return (citation) => {
    if (citation.kind === "web") {
      openExternal(citation.url).catch((error: unknown) => {
        onError(errorMessage(error));
      });
      return;
    }
    const link = parseFlowLink(citation.source);
    const href = link === null ? null : internalHref(link, outline);
    if (href === null) {
      onError("出典の節が見つかりません");
    } else {
      void navigate(href);
    }
  };
}

/**
 * 回答の最後の出典の一覧。原稿の節と、Web で調べた語の出典は分けて出す
 * （Web の内容は答えの根拠にしないので、混ぜると根拠のように見えるため）。
 * 既定では閉じておく（回答ごとに一覧が並ぶと会話が長くなり、文の中のチップから節を開けるため）。
 */
function SourceList({ citations }: { citations: ChatCitation[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const manual = citations.filter((c) => c.kind === "manual");
  const web = citations.filter((c) => c.kind === "web");
  const counts = [
    ...(manual.length > 0 ? [`出典 ${String(manual.length)} 件`] : []),
    ...(web.length > 0 ? [`Web で調べた語 ${String(web.length)} 件`] : []),
  ].join("・");
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" />}
      >
        <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} aria-hidden />
        {counts}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1.5 pt-1">
        {/* 見出しは開け閉めのボタンにあるので、中では繰り返さない。Web の出典は地球のアイコンで分かる */}
        {manual.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {manual.map((c) => (
              <CitationChip key={citationKey(c)} citation={c} />
            ))}
          </div>
        )}
        {web.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {web.map((c) => (
              <CitationChip key={citationKey(c)} citation={c} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)} 万` : n.toLocaleString("ja-JP");
}

/** トークン数（金額は出さない。単価は変わるので、利用者が Anthropic の Console で確かめる）。 */
function UsageDetail({ usage }: { usage: ChatUsage }): JSX.Element {
  // キャッシュから読んだ分は料金が 1 割なので、合計に混ぜると重く見える。分けて出す
  const input = usage.inputTokens + usage.cacheWriteTokens;
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={<Button variant="ghost" size="xs" className="text-muted-foreground" />}
      >
        入力 {formatTokens(input)}（キャッシュ {formatTokens(usage.cacheReadTokens)}）・出力{" "}
        {formatTokens(usage.outputTokens)} トークン
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-1 text-xs">
        <span>入力（キャッシュなし）: {formatTokens(usage.inputTokens)}</span>
        <span>入力（キャッシュから）: {formatTokens(usage.cacheReadTokens)}</span>
        <span>入力（キャッシュへ書き込み）: {formatTokens(usage.cacheWriteTokens)}</span>
        <span>出力: {formatTokens(usage.outputTokens)}</span>
        {usage.webSearches > 0 && <span>Web 検索: {usage.webSearches} 回</span>}
        <span className="text-muted-foreground">
          料金は Anthropic の Console で確かめてください
        </span>
      </HoverCardContent>
    </HoverCard>
  );
}

/** AI からの聞き返し。選択肢は数字キーでも選べる（トリアージのフローと同じ操作）。 */
function AskUser({
  item,
  disabled,
  onAnswer,
}: {
  item: Extract<AnswerItem, { kind: "ask" }>;
  disabled: boolean;
  onAnswer: (toolUseId: string, answer: string) => void;
}): JSX.Element {
  if (item.answer !== null) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {item.question} → {item.answer}
        </span>
      </p>
    );
  }
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const chosen = new FormData(event.currentTarget)
      .getAll("answer")
      .filter((v) => typeof v === "string");
    if (chosen.length > 0) {
      onAnswer(item.toolUseId, chosen.join("、"));
    }
  }
  return (
    <Questionnaire
      className="rounded-lg border p-3"
      items={[
        { name: "answer", required: true, choices: item.options.map((value) => ({ value })) },
      ]}
      shortcuts="numbers"
      onSubmit={handleSubmit}
    >
      <QuestionnaireItem name="answer" required multiple={item.multiSelect} disabled={disabled}>
        <QuestionnaireTitle>{item.question}</QuestionnaireTitle>
        <QuestionnaireDescription>
          選択肢にないときは、下の入力欄に書いて送ってください
        </QuestionnaireDescription>
        <QuestionnaireChoices>
          {item.options.map((option) => (
            <QuestionnaireChoice key={option} value={option}>
              {option}
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireSubmit disabled={disabled}>答える</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}
