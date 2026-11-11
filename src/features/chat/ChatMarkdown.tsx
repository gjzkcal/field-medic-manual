import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  placeCitationMarks,
  placeFlowLinks,
  renderChatMarkdown,
  splitBlocks,
  splitCitationMarks,
} from "@/features/chat/chat-markdown";
import { FlowLinkButton } from "@/features/chat/FlowLinkButton";
import { cn } from "@/lib/utils";

interface ChatMarkdownProps {
  text: string;
  /** 書いている途中なら、最後の塊を書きかけとして、届いた分を組み直しながら出す（閉じた塊は描き直さない） */
  streaming: boolean;
  /** 本文の中の引用の印（`citationMark`）の場所に描く部品 */
  renderMark?: (index: number) => ReactNode;
  className?: string;
}

/**
 * 回答や質問の Markdown。ビューアと同じ本文のクラス（manual-body）で描く。
 * 塊（段落・表など）ごとに描き、閉じた塊は描き直さない。全体を描き直すと、文字が届くたびに画面がちらつき、
 * 描き終わるまでの間に段落が消えて別の場所に現れるため。
 */
export function ChatMarkdown({
  text,
  streaming,
  renderMark,
  className,
}: ChatMarkdownProps): JSX.Element {
  const { blocks, tail } = splitBlocks(text, streaming);
  const parts = tail.trim() === "" ? blocks : [...blocks, tail];
  return (
    <div className={cn("manual-body text-sm", className)}>
      {parts.map((part, index) => (
        <MarkdownBlock
          // 塊は後ろに足されるだけで順番は変わらない。書きかけの塊が閉じても同じ番号のまま描き続け、
          // 閉じたときに描き直しで見た目が跳ばないようにする
          // eslint-disable-next-line @eslint-react/no-array-index-key -- 上の理由
          key={index}
          text={part}
          renderMark={renderMark}
        />
      ))}
    </div>
  );
}

interface RenderedBlock {
  root: HTMLDivElement;
  slots: { slot: HTMLElement; index: number }[];
  flows: { slot: HTMLElement; flowId: string; label: string }[];
  generation: number;
}

/**
 * 1 つの塊。組み直している間は前に描いたものを出したままにし、組み終わったら同じ描画の中で差し替える
 * （引用のチップも同じ描画で入れ替わるので、一瞬消えない）。
 */
function MarkdownBlock({
  text,
  renderMark,
}: {
  text: string;
  renderMark: ((index: number) => ReactNode) | undefined;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<RenderedBlock | null>(null);
  const latestRef = useRef(text);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const frameRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    latestRef.current = text;
    // 組み直している途中なら、終わってから最新の文で組み直す（文字が届くたびに組み直さない）
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }
    const run = (): void => {
      runningRef.current = true;
      const source = latestRef.current;
      const root = document.createElement("div");
      renderChatMarkdown(source)
        .then(
          (fragment) => {
            root.append(fragment);
          },
          () => {
            // 組めなかったときは、文字のまま見せる（引用の印は外す）
            root.textContent = plainText(source);
          },
        )
        .finally(() => {
          if (!mountedRef.current) {
            return;
          }
          const slots = placeCitationMarks(root);
          const flows = placeFlowLinks(root);
          setRendered((prev) => ({
            root,
            slots,
            flows,
            generation: (prev?.generation ?? 0) + 1,
          }));
          // 組むのは 1 ms ほどなので、次のフレームで最新の文を組み直す（1 フレームに 1 回まで）
          frameRef.current = requestAnimationFrame(() => {
            runningRef.current = false;
            if (pendingRef.current && mountedRef.current) {
              pendingRef.current = false;
              run();
            }
          });
        });
    };
    run();
  }, [text]);

  // portal は組んだ root の中の span に描かれている。同じ描画の中で root の中身を画面へ移す
  useLayoutEffect(() => {
    // 移した後の root は空になる。同じ root でもう一度呼ばれても（開発時の StrictMode）、画面を空にしない
    if (rendered !== null && ref.current !== null && rendered.root.hasChildNodes()) {
      ref.current.replaceChildren(...Array.from(rendered.root.childNodes));
    }
  }, [rendered]);

  return (
    <>
      <div ref={ref} hidden={rendered === null} />
      {/* 初めて描き終わるまでは文字のまま、同じ場所に出しておく */}
      {rendered === null && <PlainText text={text} renderMark={renderMark} />}
      {rendered?.flows.map(({ slot, flowId, label }, i) =>
        createPortal(
          <FlowLinkButton flowId={flowId} label={label} />,
          slot,
          `flow-${String(rendered.generation)}-${String(i)}`,
        ),
      )}
      {rendered !== null &&
        renderMark !== undefined &&
        rendered.slots.map(({ slot, index }, i) =>
          createPortal(renderMark(index), slot, `${String(rendered.generation)}-${String(i)}`),
        )}
    </>
  );
}

function PlainText({
  text,
  renderMark,
}: {
  text: string;
  renderMark: ((index: number) => ReactNode) | undefined;
}): JSX.Element {
  return (
    <p className="whitespace-pre-wrap">
      {splitCitationMarks(text.trim()).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={`mark-${String(i)}`}>{renderMark?.(part)}</span>
        ),
      )}
    </p>
  );
}

function plainText(text: string): string {
  return splitCitationMarks(text)
    .filter((part) => typeof part === "string")
    .join("");
}
