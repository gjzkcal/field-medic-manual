import {
  CopyIcon,
  KeyRoundIcon,
  MessageSquareTextIcon,
  PencilIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { useNavigate } from "react-router";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAiKey } from "@/features/chat/ai-key";
import { useAiSettings } from "@/features/chat/ai-settings";
import { useChatStore } from "@/features/chat/chat-store";
import type { ChatTurn } from "@/features/chat/chat-turn";
import { ChatAnswer } from "@/features/chat/ChatAnswer";
import { renderChatMarkdown } from "@/features/chat/chat-markdown";
import { ChatMarkdown } from "@/features/chat/ChatMarkdown";
import {
  ChatPromptInput,
  MAX_QUESTION_CHARS,
  type ChatPromptInputHandle,
} from "@/features/chat/ChatPromptInput";
import { useContentSync } from "@/features/content/sync";
import { CopyButton } from "@/features/library/viewer/CopyButton";
import { aiChatReset } from "@/lib/tauri";

/** 最初の画面に出す質問の例。原稿の言い方と違う聞き方でも答えられることを見せる */
const SUGGESTIONS = [
  "TQ はどこに巻けばいい？",
  "血が止まらないときは？",
  "倒れて動かない仲間がいる",
  "モルヒネは何本まで打てる？",
];

// この幅より狭いと、本文の横に並べると読めないので、本文に重ねて出す
const SIDE_BY_SIDE_QUERY = "(min-width: 1200px)";

function subscribeWidth(onChange: () => void): () => void {
  const mql = window.matchMedia(SIDE_BY_SIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

function wideSnapshot(): boolean {
  return window.matchMedia(SIDE_BY_SIDE_QUERY).matches;
}

// 画面を読み直したときに Rust にだけ会話が残っていると、表示と送る履歴がずれるので、アプリを開いて最初に 1 回消す
let resetOnce = false;

/** 上の帯の「AI に質問」のボタン。どのページからでも開ける。 */
export function ChatToggleButton(): JSX.Element {
  const open = useChatStore((s) => s.panelOpen);
  const setOpen = useChatStore((s) => s.setPanelOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);
  // 閉じたらこのボタンにフォーカスを戻す。横に並べたパネルは閉じると消えるので、そのままではフォーカスが本文の頭に落ちる。
  // ほかの所（本文のリンクなど）にフォーカスがあるときは動かさない
  useEffect(() => {
    if (wasOpenRef.current && !open && document.activeElement === document.body) {
      buttonRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={buttonRef}
            variant={open ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="AI に質問"
            aria-pressed={open}
            onClick={() => {
              setOpen(!open);
            }}
          />
        }
      >
        <MessageSquareTextIcon />
      </TooltipTrigger>
      <TooltipContent>AI に質問</TooltipContent>
    </Tooltip>
  );
}

/**
 * チャットのパネルの置き場所。広い画面では本文の右に並べ、狭い画面では本文の上に重ねる。
 * どちらも上の帯（タイトルバーを兼ねる）より下に置く。全面を覆うダイアログにすると、
 * ウィンドウの移動・最小化・閉じるが押せなくなるため。
 */
export function ChatPanelHost(): JSX.Element | null {
  const open = useChatStore((s) => s.panelOpen);
  const setOpen = useChatStore((s) => s.setPanelOpen);
  const wide = useSyncExternalStore(subscribeWidth, wideSnapshot);
  if (!open) {
    return null;
  }
  return (
    <aside
      aria-label="AI に質問"
      className={
        wide
          ? "flex w-[26rem] shrink-0 flex-col border-l bg-background"
          : "absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
      }
      onKeyDown={(event) => {
        // 重ねて出しているときは本文が隠れるので、Esc で閉じられるようにする（入力の変換中の Esc は除く）
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          setOpen(false);
        }
      }}
    >
      <ChatPanel />
    </aside>
  );
}

function ChatPanel(): JSX.Element {
  const turns = useChatStore((s) => s.turns);
  const busy = useChatStore((s) => s.busy);
  const notice = useChatStore((s) => s.notice);
  const conversation = useChatStore((s) => s.conversation);
  const send = useChatStore((s) => s.send);
  const answer = useChatStore((s) => s.answer);
  const decide = useChatStore((s) => s.decide);
  const cancel = useChatStore((s) => s.cancel);
  const reset = useChatStore((s) => s.reset);
  const setOpen = useChatStore((s) => s.setPanelOpen);
  const keyStatus = useAiKey((s) => s.status);
  const refreshKey = useAiKey((s) => s.refresh);
  const settings = useAiSettings((s) => s.settings);
  const syncStatus = useContentSync((s) => s.state.status);
  const inputRef = useRef<ChatPromptInputHandle>(null);

  useEffect(() => {
    void refreshKey();
    // 回答の Markdown の変換は初めて使うときにライブラリを読み込むので、開いたときに先に読んでおく。
    // 回答の頭で読み込みを待つと、書き始めの段落が古い文で描かれて一瞬縮むため
    renderChatMarkdown("").catch(() => {
      // 読めなければ、回答のときにもう一度読む
    });
    if (!resetOnce && useChatStore.getState().turns.length === 0) {
      resetOnce = true;
      void aiChatReset().catch(() => {
        // 消せなくても、次の質問で同じ会話に続くだけ
      });
    }
  }, [refreshKey]);

  // 開いたら、キーの状態が分かってから 1 回だけ、入力欄（キーがなければ見出し）にフォーカスを移す。
  // 状態が分かる前に移すと、入力欄が案内に替わったときにフォーカスが本文に落ちるため
  const focusedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (keyStatus === null || focusedRef.current) {
      return;
    }
    focusedRef.current = true;
    if (keyStatus === "set") {
      inputRef.current?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [keyStatus]);

  const pendingAsk = turns.at(-1)?.items.findLast((i) => i.kind === "ask" && i.answer === null);
  const answering = busy && pendingAsk?.kind === "ask";
  const ready = syncStatus === "done" || syncStatus === "error";
  const settingsPending =
    conversation !== null &&
    (conversation.model !== settings.model || conversation.effort !== settings.effort);

  function handleSend(text: string, images: Parameters<typeof send>[1]): void {
    if (answering) {
      void answer(pendingAsk.toolUseId, text);
      return;
    }
    void send(text, images);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <h2 ref={headingRef} tabIndex={-1} className="flex-1 text-sm font-semibold outline-none">
          AI に質問
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="新しい会話"
                disabled={turns.length === 0}
                onClick={() => {
                  void reset().then(() => inputRef.current?.focus());
                }}
              />
            }
          >
            <SquarePenIcon />
          </TooltipTrigger>
          <TooltipContent>新しい会話（今の会話は消えます）</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="閉じる"
          onClick={() => {
            setOpen(false);
          }}
        >
          <XIcon />
        </Button>
      </div>
      {keyStatus === "missing" || keyStatus === "unavailable" ? (
        <KeyMissing unavailable={keyStatus === "unavailable"} />
      ) : (
        <>
          <MessageScrollerProvider autoScroll>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport aria-label="AI との会話">
                <MessageScrollerContent aria-busy={busy} className="gap-4 p-3">
                  {turns.length === 0 ? (
                    <MessageScrollerItem messageId="empty">
                      <Suggestions
                        disabled={!ready || busy}
                        onPick={(text) => {
                          void send(text, []);
                        }}
                      />
                    </MessageScrollerItem>
                  ) : (
                    turns.flatMap((turn) => [
                      <MessageScrollerItem
                        key={`q-${String(turn.id)}`}
                        messageId={`q-${String(turn.id)}`}
                        scrollAnchor
                      >
                        <Question turn={turn} busy={busy} />
                      </MessageScrollerItem>,
                      <MessageScrollerItem
                        key={`a-${String(turn.id)}`}
                        messageId={`a-${String(turn.id)}`}
                      >
                        <Message>
                          <MessageContent>
                            <ChatAnswer
                              turn={turn}
                              onAnswer={(toolUseId, text) => {
                                void answer(toolUseId, text);
                              }}
                              onDecide={(toolUseId, approve) => {
                                void decide(toolUseId, approve);
                              }}
                            />
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>,
                    ])
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="flex shrink-0 flex-col gap-1.5 border-t p-3">
            {notice !== null && (
              <p role="status" className="text-xs text-muted-foreground">
                {notice}
              </p>
            )}
            {!ready && (
              <p role="status" className="text-xs text-muted-foreground">
                マニュアルを読み込んでいます。終わるまで送れません
              </p>
            )}
            <ChatPromptInput
              ref={inputRef}
              busy={busy || !ready}
              answering={answering}
              settingsPending={settingsPending}
              onSend={handleSend}
              onStop={() => {
                void cancel();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function KeyMissing({ unavailable }: { unavailable: boolean }): JSX.Element {
  const navigate = useNavigate();
  const setOpen = useChatStore((s) => s.setPanelOpen);
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>
          {unavailable ? "API キーを読めません" : "API キーが登録されていません"}
        </EmptyTitle>
        <EmptyDescription>
          {unavailable
            ? "Windows の資格情報マネージャーを使えませんでした。"
            : "AI に質問するには、Anthropic の API キーを設定で登録してください。"}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          onClick={() => {
            void navigate("/settings#ai");
            setOpen(false);
          }}
        >
          設定を開く
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function Suggestions({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (text: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3 py-6 text-sm">
      <p className="text-muted-foreground">
        マニュアルを根拠に AI が答えます。原稿と違う言い方でも聞けます。
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((text) => (
          <Button
            key={text}
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onPick(text);
            }}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** 利用者の質問。コピーと編集（その質問から後ろを消して送り直す）ができる。 */
function Question({ turn, busy }: { turn: ChatTurn; busy: boolean }): JSX.Element {
  const edit = useChatStore((s) => s.edit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.question);
  const canEdit = turn.turnIndex !== null && !busy;
  if (editing) {
    return (
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (text !== "") {
            setEditing(false);
            void edit(turn.id, text);
          }
        }}
      >
        <Textarea
          value={draft}
          maxLength={MAX_QUESTION_CHARS}
          aria-label="質問を直す"
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          送ると、この質問から後ろの会話は消えて、直した質問から答え直します
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(turn.question);
              setEditing(false);
            }}
          >
            やめる
          </Button>
          <Button type="submit" size="sm" disabled={busy || draft.trim() === ""}>
            送り直す
          </Button>
        </div>
      </form>
    );
  }
  return (
    <Message align="end">
      <MessageContent>
        {turn.images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {turn.images.map((image) => (
              <img
                key={image.url}
                src={image.url}
                alt={`付けた画像: ${image.name}`}
                className="max-h-32 rounded-md border object-contain"
              />
            ))}
          </div>
        )}
        <Bubble align="end" variant="muted">
          <BubbleContent>
            {/* 吹き出しは中身の幅に合わせて縮むが、manual-body の container（inline-size）は中身から幅を決めないので、
                そのままだと幅が 0 になって 1 文字ずつ折り返す。質問の中では container を外す */}
            <ChatMarkdown
              text={turn.question}
              streaming={false}
              className="[container-type:normal] [&>:last-child]:mb-0 [&>:last-child>:last-child]:mb-0"
            />
          </BubbleContent>
        </Bubble>
        <MessageFooter className="gap-0.5">
          <CopyButton
            value={() => turn.question}
            label="質問をコピー"
            doneLabel="質問をコピーしました"
            failLabel="質問をコピーできませんでした"
            icon={<CopyIcon />}
          />
          {canEdit && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="質問を直す"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraft(turn.question);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
          )}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}
