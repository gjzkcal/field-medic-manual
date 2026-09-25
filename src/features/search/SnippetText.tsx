import type { JSX } from "react";

import { splitSnippet } from "@/features/search/snippet";

interface SnippetTextProps {
  snippet: string;
}

/** 検索結果のスニペットを、ヒットした語を強調して表示する。 */
export function SnippetText({ snippet }: SnippetTextProps): JSX.Element {
  return (
    <span className="text-sm text-muted-foreground">
      {splitSnippet(snippet).map((part) =>
        part.hit ? (
          <mark key={part.start} className="rounded-sm bg-primary/25 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </span>
  );
}
