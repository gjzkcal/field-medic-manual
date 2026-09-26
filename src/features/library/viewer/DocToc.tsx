import type { JSX } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { docHref } from "@/features/library/link";
import { headingIndent } from "@/features/library/viewer/heading-indent";
import type { OutlineHeading } from "@/lib/bindings/OutlineHeading";
import { cn } from "@/lib/utils";

interface DocTocProps {
  docId: string;
  headings: readonly OutlineHeading[];
  /** 今読んでいる節の見出し */
  activeAnchor: string | null;
}

/** 今の文書の目次。読んでいる位置を強調し、長い文書で自分がどこにいるか分かるようにする。 */
export function DocToc({ docId, headings, activeAnchor }: DocTocProps): JSX.Element {
  return (
    <nav aria-label="目次" className="flex flex-col gap-0.5 p-3">
      <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">目次</p>
      {headings.map((h) => {
        const active = h.anchor === activeAnchor;
        return (
          <Button
            key={h.anchor}
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to={docHref(docId, h.anchor)} />}
            aria-current={active ? "location" : undefined}
            className={cn(
              "h-auto min-h-7 justify-start rounded-l-none border-l-2 border-transparent py-1 text-left font-normal whitespace-normal text-muted-foreground hover:text-foreground",
              headingIndent(h.level),
              active && "border-l-primary bg-muted font-semibold text-foreground",
            )}
          >
            {h.title}
          </Button>
        );
      })}
    </nav>
  );
}
