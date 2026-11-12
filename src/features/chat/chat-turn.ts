// 質問 1 回分の表示の状態と、Rust から届くイベントの反映。純関数にして、画面と分けて確かめられるようにする。
import { citationMark } from "@/features/chat/chat-markdown";
import { manualSourcePath } from "@/features/content/path";
import { quickrefHref } from "@/features/quickref/link";
import { shareUrl } from "@/features/library/share-link";
import { parseFlowLink } from "@/features/triage/links";
import type { ChatCitation } from "@/lib/bindings/ChatCitation";
import type { ChatEvent } from "@/lib/bindings/ChatEvent";
import type { ChatNotice } from "@/lib/bindings/ChatNotice";
import type { ChatTurnResult } from "@/lib/bindings/ChatTurnResult";
import type { ChatUsage } from "@/lib/bindings/ChatUsage";
import type { ClientRequest } from "@/lib/bindings/ClientRequest";
import type { ProposedOp } from "@/lib/bindings/ProposedOp";
import type { ToolKind } from "@/lib/bindings/ToolKind";
import type { ToolState } from "@/lib/bindings/ToolState";
import { WEB_BASE, WEB_ORIGIN } from "@/lib/web-site";

/** 回答の中身。届いた順に並べる（考えている途中・ツール・本文・聞き返しが入り混じる） */
export type AnswerItem =
  | { kind: "text"; block: number; text: string; citations: ChatCitation[] }
  | { kind: "thinking"; block: number; text: string }
  | { kind: "tool"; id: string; tool: ToolKind; detail: string; state: ToolState }
  | {
      kind: "ask";
      toolUseId: string;
      question: string;
      options: string[];
      multiSelect: boolean;
      answer: string | null;
    }
  | {
      kind: "propose";
      toolUseId: string;
      summary: string;
      ops: ProposedOp[];
      /** 承認を待っている・記録した・却下した・記録の途中で失敗した */
      status: ProposalStatus;
      error: string | null;
    };

export type ProposalStatus = "pending" | "applying" | "approved" | "rejected" | "failed";

export type TurnState = "streaming" | "done" | "truncated" | "refused" | "cancelled" | "error";

export interface ChatImageView {
  /** 表示用の Blob URL。会話を消したら解放する */
  url: string;
  name: string;
}

export interface ChatTurn {
  id: number;
  question: string;
  images: ChatImageView[];
  items: AnswerItem[];
  state: TurnState;
  /** 失敗・拒否の説明 */
  message: string | null;
  notices: ChatNotice[];
  usage: ChatUsage | null;
  /** Rust の会話の中の番号。会話に残らなかった質問は null（編集できない） */
  turnIndex: number | null;
}

export function newTurn(id: number, question: string, images: ChatImageView[]): ChatTurn {
  return {
    id,
    question,
    images,
    items: [],
    state: "streaming",
    message: null,
    notices: [],
    usage: null,
    turnIndex: null,
  };
}

/** イベントを 1 つ反映した新しい状態を返す（元の状態は変えない）。 */
export function applyEvent(turn: ChatTurn, event: ChatEvent): ChatTurn {
  switch (event.type) {
    case "text":
    case "thinking": {
      const index = turn.items.findIndex((i) => i.kind === event.type && i.block === event.block);
      if (index === -1) {
        const item: AnswerItem =
          event.type === "text"
            ? { kind: "text", block: event.block, text: event.text, citations: [] }
            : { kind: "thinking", block: event.block, text: event.text };
        return { ...turn, items: [...turn.items, item] };
      }
      return {
        ...turn,
        items: turn.items.map((item, i) =>
          i === index && (item.kind === "text" || item.kind === "thinking")
            ? { ...item, text: item.text + event.text }
            : item,
        ),
      };
    }
    case "citation": {
      const index = turn.items.findIndex((i) => i.kind === "text" && i.block === event.block);
      if (index === -1) {
        // 引用は本文より先に届くことがある（API は引用を本文のブロックの頭で送る）
        return {
          ...turn,
          items: [
            ...turn.items,
            { kind: "text", block: event.block, text: "", citations: [event.citation] },
          ],
        };
      }
      return {
        ...turn,
        items: turn.items.map((item, i) =>
          i === index && item.kind === "text"
            ? { ...item, citations: [...item.citations, event.citation] }
            : item,
        ),
      };
    }
    case "tool_activity": {
      const index = turn.items.findIndex((i) => i.kind === "tool" && i.id === event.id);
      if (index === -1) {
        return {
          ...turn,
          items: [
            ...turn.items,
            {
              kind: "tool",
              id: event.id,
              tool: event.tool,
              detail: event.detail,
              state: event.state,
            },
          ],
        };
      }
      return {
        ...turn,
        items: turn.items.map((item, i) =>
          i === index && item.kind === "tool"
            ? {
                ...item,
                state: event.state,
                // Web 検索の結果のイベントには語が付かないので、始まったときの語を残す
                detail: event.detail === "" ? item.detail : event.detail,
              }
            : item,
        ),
      };
    }
    case "client_request":
      return withRequest(turn, event.toolUseId, event.request);
    case "notice":
      return turn.notices.includes(event.notice)
        ? turn
        : { ...turn, notices: [...turn.notices, event.notice] };
    case "usage":
      return { ...turn, usage: event.usage };
  }
}

/** 画面で答える要求を、表示に足す。 */
function withRequest(turn: ChatTurn, toolUseId: string, request: ClientRequest): ChatTurn {
  switch (request.kind) {
    case "ask_user":
      return {
        ...turn,
        items: [
          ...turn.items,
          {
            kind: "ask",
            toolUseId,
            question: request.question,
            options: request.options,
            multiSelect: request.multiSelect,
            answer: null,
          },
        ],
      };
    case "casualty_propose":
      return {
        ...turn,
        items: [
          ...turn.items,
          {
            kind: "propose",
            toolUseId,
            summary: request.summary,
            ops: request.ops,
            status: "pending",
            error: null,
          },
        ],
      };
    // 記録を読む要求は、画面が黙って答える（読んだことは Rust が「調べた様子」に出す）
    case "casualty_read":
      return turn;
  }
}

/** 聞き返しへの答えを表示に残す。 */
export function answerAsk(turn: ChatTurn, toolUseId: string, answer: string): ChatTurn {
  return {
    ...turn,
    items: turn.items.map((item) =>
      item.kind === "ask" && item.toolUseId === toolUseId ? { ...item, answer } : item,
    ),
  };
}

/** 提案への答えを表示に残す。 */
export function decideProposal(
  turn: ChatTurn,
  toolUseId: string,
  status: ProposalStatus,
  error: string | null = null,
): ChatTurn {
  return {
    ...turn,
    items: turn.items.map((item) =>
      item.kind === "propose" && item.toolUseId === toolUseId ? { ...item, status, error } : item,
    ),
  };
}

export function finishTurn(turn: ChatTurn, result: ChatTurnResult): ChatTurn {
  const base = { ...turn, usage: result.usage, turnIndex: result.turnIndex };
  switch (result.status.kind) {
    case "completed":
      return { ...base, state: "done" };
    case "truncated":
      return { ...base, state: "truncated", message: "回答が長くなったので途中で止めました" };
    case "cancelled":
      return { ...base, state: "cancelled", message: "止めました" };
    case "refused":
      return {
        ...base,
        state: "refused",
        message: `この質問には答えられませんでした。言い方を変えて聞いてみてください${
          result.status.explanation === null ? "" : `（${result.status.explanation}）`
        }`,
      };
  }
}

export function failTurn(turn: ChatTurn, message: string): ChatTurn {
  return { ...turn, state: "error", message };
}

/** 回答の本文（考えている途中・ツールを除いた Markdown）。 */
export function answerText(turn: ChatTurn): string {
  return turn.items
    .flatMap((item) => (item.kind === "text" ? [item.text] : []))
    .join("")
    .trim();
}

export function citationKey(citation: ChatCitation): string {
  return citation.kind === "manual" ? citation.source : citation.url;
}

export type TextItem = Extract<AnswerItem, { kind: "text" }>;

/**
 * 続いた本文のブロックを 1 つの Markdown にまとめ、引用の付いたブロックの終わりに `mark` が返す印を入れる。
 * API は引用の付いた部分ごとに本文をブロックに分けて返すので、ブロックごとに描くと文や箇条書きが途中で切れるため。
 */
export function mergeTextRun(
  items: readonly TextItem[],
  mark: (citations: readonly ChatCitation[]) => string,
): string {
  return items
    .map((item) => {
      if (item.citations.length === 0) {
        return item.text;
      }
      // 改行の前に入れる（改行の後に入れると、次の段落の頭に印が出るため）
      const body = item.text.trimEnd();
      return `${body}${mark(item.citations)}${item.text.slice(body.length)}`;
    })
    .join("");
}

/** 引用の場所に、回答の中の出典の番号を [1][2] の形で入れる（コピーする文のため）。同じ出典は同じ番号にする。 */
export function numberMarks(
  number: (citation: ChatCitation) => number,
): (citations: readonly ChatCitation[]) => string {
  return (citations) =>
    [...new Set(citations.map((citation) => number(citation)))]
      .toSorted((a, b) => a - b)
      .map((n) => `[${String(n)}]`)
      .join("");
}

/**
 * 画面に出す本文。引用の場所に印（`citationMark`）を入れ、印の番号から、その場所で引いた出典を引けるようにする。
 * 場所ごとに引いた文が違うので、回答全体の出典の一覧とは別に、場所ごとに持つ。
 */
export function mergeWithMarks(items: readonly TextItem[]): {
  text: string;
  marks: (readonly ChatCitation[])[];
} {
  const marks: (readonly ChatCitation[])[] = [];
  const text = mergeTextRun(items, (citations) => {
    marks.push(citations);
    return citationMark(marks.length - 1);
  });
  return { text, marks };
}

/** 文の中のチップの名前の上限（文字数）。長いと同じ文が何度も並んで本文が読みにくくなる */
const MAX_CHIP_CHARS = 12;

/**
 * 文の中のチップの名前。「フェニレフリン > 効果」なら「効果」のように見出しの最後の段だけにし、長ければ縮める。
 * クイック表の行は症状の文が長く途中で切ると意味が取れないので「クイック表」にする（載せれば全体が出る）。
 * source から作らないのは、クイック表の行の id（blood-loss など）が利用者には読めないため。
 */
export function chipLabel(citation: Extract<ChatCitation, { kind: "manual" }>): string {
  const last = citation.title.split(" > ").at(-1) ?? citation.title;
  // 結合文字を途中で切らないよう、見た目の 1 文字ずつに分ける
  const chars = Array.from(
    new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(last),
    (g) => g.segment,
  );
  if (chars.length <= MAX_CHIP_CHARS) {
    return last;
  }
  return citation.source.startsWith("quickref:")
    ? "クイック表"
    : `${chars.slice(0, MAX_CHIP_CHARS - 1).join("")}…`;
}

/** 回答の出典を重複なしで（届いた順）。 */
export function turnCitations(turn: ChatTurn): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const item of turn.items) {
    if (item.kind !== "text") {
      continue;
    }
    for (const citation of item.citations) {
      const key = citationKey(citation);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(citation);
      }
    }
  }
  return out;
}

/**
 * 出典を、仲間に送れる URL にする。原稿の節とクイック表は Web 版の URL（デスクトップ版の文書の id は端末ごとに違うため）。
 * 書式の分からない出典は null。
 */
export function citationUrl(citation: ChatCitation): string | null {
  if (citation.kind === "web") {
    return citation.url;
  }
  const link = parseFlowLink(citation.source);
  switch (link?.kind) {
    case "doc":
      return shareUrl(manualSourcePath(link.fileName), link.anchor);
    case "quickref":
      return `${WEB_ORIGIN}${WEB_BASE.replace(/\/$/u, "")}${quickrefHref(link.rowId)}`;
    case "flow":
      return flowWebUrl(link.flowId);
    // 外部のリンクは Web の出典として別に持つ
    case "external":
    case undefined:
      return null;
  }
}

/** フローの Web 版の URL（Web 版でもフローを開ける）。 */
function flowWebUrl(flowId: string): string {
  return `${WEB_ORIGIN}${WEB_BASE.replace(/\/$/u, "")}/triage/${encodeURIComponent(flowId)}`;
}

/** 回答の中の出典の番号（1 始まり）。画面とコピーで同じ番号にする。 */
export function citationNumbering(turn: ChatTurn): (citation: ChatCitation) => number {
  const keys = turnCitations(turn).map((citation) => citationKey(citation));
  return (citation) => keys.indexOf(citationKey(citation)) + 1;
}

/** コピーするときの文。本文の Markdown（引用の番号付き）に、出典の一覧（見出しと Web 版の URL）を付ける。 */
export function answerForCopy(turn: ChatTurn): string {
  const texts = turn.items.filter((item): item is TextItem => item.kind === "text");
  const body = mergeTextRun(texts, numberMarks(citationNumbering(turn)))
    .replaceAll(/```figure[ \t]*\r?\n[^\n]*\r?\n```/gu, "")
    // フローへのリンクは、貼った先でも開けるよう Web 版の URL にする
    .replaceAll(
      /\[([^\]]*)\]\(flow:([a-z0-9-]+)\)/gu,
      (_match, label: string, flowId: string) => `${label}（${flowWebUrl(flowId)}）`,
    )
    .trim();
  const sources = turnCitations(turn).flatMap((citation, index) => {
    const url = citationUrl(citation);
    return url === null ? [] : [`[${String(index + 1)}] ${citation.title}: ${url}`];
  });
  return sources.length === 0 ? body : `${body}\n\n出典:\n${sources.join("\n")}`;
}
