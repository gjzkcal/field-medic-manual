import { ExternalLinkIcon, FileTextIcon, TableIcon, WorkflowIcon } from "lucide-react";
import { useState, type JSX } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { manualSourcePath } from "@/features/content/path";
import { docHref } from "@/features/library/link";
import { useOutline } from "@/features/library/viewer/use-doc-data";
import type { FlowLookup } from "@/features/triage/runner";
import { parseFlowLink, type FlowLink } from "@/features/triage/links";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import { errorMessage, openExternal } from "@/lib/tauri";

interface FlowLinksProps {
  links: readonly string[];
  /** flow: のリンクの名前を引くため。読み込んでいないフローは id で出す */
  lookup: FlowLookup;
}

/** action / end の関連リンク。マニュアルはビューアへ、フローは実行画面へ、外部は既定のブラウザで開く。 */
export function FlowLinks({ links, lookup }: FlowLinksProps): JSX.Element | null {
  const outline = useOutline();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const parsed = links.flatMap((text) => {
    const link = parseFlowLink(text);
    return link === null ? [] : [{ text, link }];
  });
  if (parsed.length === 0) {
    return null;
  }

  function open(link: FlowLink): void {
    setNotice(null);
    switch (link.kind) {
      case "doc": {
        const doc = findDoc(outline, link.fileName);
        if (doc === undefined) {
          setNotice(`リンク先のマニュアルが見つかりません: ${link.fileName}`);
          return;
        }
        void navigate(docHref(doc.id, link.anchor));
        return;
      }
      case "flow":
        void navigate(`/triage/${encodeURIComponent(link.flowId)}`);
        return;
      case "external":
        openExternal(link.url).catch((error: unknown) => {
          setNotice(`リンクを開けませんでした: ${errorMessage(error)}`);
        });
        return;
      case "quickref":
        return;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">関連ページ</h3>
      <ul className="flex flex-col gap-1.5">
        {parsed.map(({ text, link }) => (
          <li key={text}>
            <Button
              variant="outline"
              className="h-auto min-h-9 w-full justify-start py-1.5 text-left whitespace-normal"
              // クイック表は Step 06 で作るまで開けない
              disabled={link.kind === "quickref"}
              onClick={() => {
                open(link);
              }}
            >
              <LinkIcon link={link} />
              {linkLabel(link, outline, lookup)}
            </Button>
          </li>
        ))}
      </ul>
      {notice !== null && (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      )}
    </div>
  );
}

function findDoc(outline: readonly DocOutline[], fileName: string): DocOutline | undefined {
  return outline.find((d) => d.sourcePath === manualSourcePath(fileName));
}

function linkLabel(link: FlowLink, outline: readonly DocOutline[], lookup: FlowLookup): string {
  switch (link.kind) {
    case "doc": {
      const doc = findDoc(outline, link.fileName);
      if (doc === undefined) {
        return link.fileName;
      }
      const heading = doc.headings.find((h) => h.anchor === link.anchor);
      return heading === undefined || heading.title === doc.title
        ? doc.title
        : `${doc.title} › ${heading.title}`;
    }
    case "flow":
      return `フロー: ${lookup(link.flowId)?.title ?? link.flowId}`;
    case "quickref":
      return "クイック表（準備中）";
    case "external":
      return link.url;
  }
}

function LinkIcon({ link }: { link: FlowLink }): JSX.Element {
  switch (link.kind) {
    case "doc":
      return <FileTextIcon />;
    case "flow":
      return <WorkflowIcon />;
    case "quickref":
      return <TableIcon />;
    case "external":
      return <ExternalLinkIcon />;
  }
}
