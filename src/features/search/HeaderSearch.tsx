import { useEffect, useRef, type JSX } from "react";
import { useNavigate } from "react-router";

import { CommandPalette } from "@/features/search/CommandPalette";

/** メインウィンドウの上部の検索欄。欄に直接打ち、結果は欄の下に出る。Ctrl+K でここへ移る。 */
export function HeaderSearch(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // 本文を読んでいる途中でもすぐ探せるよう、ウィンドウ全体で受ける
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        // 前の語が残っていれば選択しておき、そのまま打てば置き換わるようにする
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <CommandPalette
      variant="dropdown"
      inputRef={inputRef}
      className="w-full max-w-xl min-w-0"
      onSelect={(href) => {
        void navigate(href);
      }}
    />
  );
}
