import { ChevronRightIcon } from "lucide-react";
import { useId, useState, type JSX } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { categoryLabel, groupByCategory } from "@/features/library/doc-category";
import { docHref } from "@/features/library/link";
import { headingIndent } from "@/features/library/viewer/heading-indent";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import { cn } from "@/lib/utils";

interface DocTreeProps {
  outline: readonly DocOutline[];
  currentId: string;
}

/** 全ドキュメントの見出しのツリー。別の文書の節へもここから直接移れるようにする。 */
export function DocTree({ outline, currentId }: DocTreeProps): JSX.Element {
  // 開閉を触っていない文書は「今の文書だけ開く」。別の文書へ移ったときに、その文書が自動で開くようにするため
  const [expanded, setExpanded] = useState<Partial<Record<string, boolean>>>({});

  return (
    <nav aria-label="マニュアルの見出し" className="flex flex-col gap-3 p-2">
      {groupByCategory(outline).map((group) => (
        <CategoryGroup key={group.category ?? ""} category={group.category}>
          {group.items.map((doc) => (
            <DocTreeItem
              key={doc.id}
              doc={doc}
              current={doc.id === currentId}
              open={expanded[doc.id] ?? doc.id === currentId}
              onOpenChange={(next) => {
                setExpanded((prev) => ({ ...prev, [doc.id]: next }));
              }}
            />
          ))}
        </CategoryGroup>
      ))}
    </nav>
  );
}

function CategoryGroup({
  category,
  children,
}: {
  category: string | null;
  children: React.ReactNode;
}): JSX.Element {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <p id={labelId} className="px-2 text-xs font-medium text-muted-foreground">
        {categoryLabel(category)}
      </p>
      {children}
    </div>
  );
}

interface DocTreeItemProps {
  doc: DocOutline;
  current: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DocTreeItem({ doc, current, open, onOpenChange }: DocTreeItemProps): JSX.Element {
  // h1 は文書のタイトルと同じことが多いので、同じならツリーでは繰り返さない
  const headings = doc.headings.filter((h) => !(h.level === 1 && h.title === doc.title));
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex items-start gap-0.5">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${doc.title}の見出しを${open ? "閉じる" : "開く"}`}
              disabled={headings.length === 0}
            />
          }
        >
          <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link to={docHref(doc.id, null)} />}
          aria-current={current ? "page" : undefined}
          className={cn(
            "h-auto min-h-7 flex-1 justify-start py-1 text-left text-sm whitespace-normal",
            current && "bg-muted font-semibold",
          )}
        >
          {doc.title}
        </Button>
      </div>
      <CollapsibleContent>
        <ul className="ml-3.5 flex flex-col border-l py-0.5">
          {headings.map((h) => (
            <li key={h.anchor}>
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link to={docHref(doc.id, h.anchor)} />}
                className={cn(
                  "h-auto min-h-7 w-full justify-start rounded-l-none py-1 text-left font-normal whitespace-normal text-muted-foreground hover:text-foreground",
                  headingIndent(h.level),
                )}
              >
                {h.title}
              </Button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
