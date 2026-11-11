import { useEffect, useRef, useState } from "react";

import { revealPrefix } from "@/features/chat/chat-markdown";

// API は文字を数文字〜数十文字のまとまりで送ってくるので、届いた分をそのまま出すとガクガク増える。
// 画面には一定の速さで少しずつ出し、溜まった分が多いほど速く出して遅れすぎないようにする
/** 溜まっていなくても出す、最低の速さ（文字/秒） */
const MIN_CHARS_PER_SECOND = 40;
/** 溜まった分を、およそこの時間で出し切る速さにする */
const CATCH_UP_MS = 400;

/**
 * 届いた本文を、少しずつ出していく。書いている途中でなければ（会話を開き直したときなど）最初から全部出す。
 * `revealing` は、まだ出し切っていない間 true（回答が終わっても、出し切るまでは書きかけとして描く）。
 */
export function useSmoothText(
  text: string,
  streaming: boolean,
): { shown: string; revealing: boolean } {
  const [length, setLength] = useState(() => (streaming ? 0 : text.length));
  const targetRef = useRef(text.length);
  const progressRef = useRef(length);
  const behind = length < text.length;

  useEffect(() => {
    targetRef.current = text.length;
  }, [text]);

  useEffect(() => {
    if (!behind) {
      return;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      // requestAnimationFrame の時刻はフレームの始まりなので、始めた時刻より前のことがある（負にすると長さが負になり、slice が全体を返す）
      const dt = Math.max(0, now - last);
      last = now;
      const backlog = targetRef.current - progressRef.current;
      const add = Math.max((MIN_CHARS_PER_SECOND * dt) / 1000, (backlog * dt) / CATCH_UP_MS);
      progressRef.current = Math.min(targetRef.current, progressRef.current + add);
      setLength(Math.max(0, Math.floor(progressRef.current)));
      if (progressRef.current < targetRef.current) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [behind]);

  return { shown: behind ? revealPrefix(text, length) : text, revealing: behind };
}
