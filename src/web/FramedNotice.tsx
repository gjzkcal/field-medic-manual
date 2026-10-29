// ほかのページの iframe の中で開かれたときに、アプリの代わりに出す画面（理由は framed.ts）。直接開く案内だけを置く
import { ExternalLinkIcon } from "lucide-react";
import type { JSX } from "react";

import { LinkButton } from "@/components/LinkButton";

export function FramedNotice(): JSX.Element {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p>このマニュアルは、ほかのページの中では表示しません。</p>
      <LinkButton
        render={<a href={window.location.href} target="_blank" rel="noopener noreferrer" />}
      >
        <ExternalLinkIcon />
        新しいタブで開く
      </LinkButton>
    </main>
  );
}
