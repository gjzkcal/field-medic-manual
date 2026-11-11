import { ImageIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, type JSX } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { figuresOnly } from "@/features/chat/figures";
import { findDocByFile } from "@/features/content/link-target";
import { docHref } from "@/features/library/link";
import { AssetUrlCache } from "@/features/library/viewer/asset-urls";
import { SectionBody } from "@/features/library/viewer/SectionBody";
import { useDoc, useOutline } from "@/features/library/viewer/use-doc-data";
import { activeMods, useModSettings } from "@/features/settings/mod-settings";
import { parseFlowLink } from "@/features/triage/links";
import { assetGet } from "@/lib/tauri";

interface FigureEmbedProps {
  /** AI が書いた節の source（`doc:<ファイル名>#<アンカー>`） */
  source: string;
}

/** AI が回答の中で示した、根拠の節の図。節が見つからなければ何も出さない（AI の書き間違いを画面に出さない）。 */
export function FigureEmbed({ source }: FigureEmbedProps): JSX.Element | null {
  const outline = useOutline();
  const link = parseFlowLink(source);
  if (link?.kind !== "doc" || link.anchor === null) {
    return null;
  }
  const doc = findDocByFile(outline, link.fileName);
  if (doc === undefined) {
    return null;
  }
  return <SectionFigures docId={doc.id} anchor={link.anchor} />;
}

function SectionFigures({ docId, anchor }: { docId: string; anchor: string }): JSX.Element | null {
  const load = useDoc(docId);
  const navigate = useNavigate();
  const mods = useModSettings((s) => s.settings);
  const assets = load.status === "ready" ? load.doc.assets : null;
  const assetCache = useMemo(() => {
    const mimes = new Map((assets ?? []).map((a) => [a.id, a.mime]));
    return new AssetUrlCache(assetGet, (assetId) => mimes.get(assetId));
  }, [assets]);
  // 回答を消したときと別の図に替わったときに Blob URL を解放する
  useEffect(
    () => () => {
      assetCache.revokeAll();
    },
    [assetCache],
  );
  const resolveAsset = useCallback((assetId: string) => assetCache.get(assetId), [assetCache]);
  if (load.status !== "ready") {
    return null;
  }
  const section = load.doc.sections.find((s) => s.anchor === anchor);
  const html = section === undefined ? "" : figuresOnly(section.html);
  if (section === undefined || html === "") {
    return null;
  }
  return (
    <figure className="flex flex-col gap-2 rounded-lg border p-3">
      {/* 図の色と、図を描けたときに代わりの文を隠す CSS は manual-body の下にだけ効く（index.css） */}
      <div className="manual-body text-sm">
        <SectionBody html={html} resolveAsset={resolveAsset} active={activeMods(mods)} />
      </div>
      <figcaption className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1">
          <ImageIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {load.doc.title} &gt; {section.title}
          </span>
        </span>
        <Button
          variant="link"
          size="xs"
          onClick={() => {
            void navigate(docHref(docId, anchor));
          }}
        >
          この節を開く
        </Button>
      </figcaption>
    </figure>
  );
}
