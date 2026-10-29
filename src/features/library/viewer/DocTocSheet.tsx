import { ListIcon } from "lucide-react";
import { useRef, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DocToc } from "@/features/library/viewer/DocToc";
import type { OutlineHeading } from "@/lib/bindings/OutlineHeading";

interface DocTocSheetProps {
  docId: string;
  headings: readonly OutlineHeading[];
  activeAnchor: string | null;
}

/**
 * 右の目次が収まらない幅（小窓・スマホ・拡大したとき）で、上の帯から目次を開くボタン。
 * 幅を詰めると目次が消えて節へ跳べなくなるのを防ぐ（WCAG 1.4.10）。目次が見えている幅では出さない
 */
export function DocTocSheet({ docId, headings, activeAnchor }: DocTocSheetProps): JSX.Element {
  const [open, setOpen] = useState(false);
  // 項目で閉じたときは、跳んだ先の見出しへビューアが移したフォーカスを残す（既定ではこのボタンへ戻ってしまう）
  const navigatedRef = useRef(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="sm" className="@3xl:hidden" />}>
        <ListIcon />
        目次
      </SheetTrigger>
      <SheetContent
        side="right"
        className="gap-0"
        finalFocus={() => {
          const keep = navigatedRef.current;
          navigatedRef.current = false;
          return !keep;
        }}
      >
        <SheetHeader className="pb-0">
          <SheetTitle>目次</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <DocToc
            docId={docId}
            headings={headings}
            activeAnchor={activeAnchor}
            showLabel={false}
            onNavigate={() => {
              navigatedRef.current = true;
              setOpen(false);
            }}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
