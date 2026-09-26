import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { manualSourcePath } from "@/features/content/path";
import { decodeAnchor, docHref, resolveLink } from "@/features/library/link";
import { AssetUrlCache } from "@/features/library/viewer/asset-urls";
import { DocFooter } from "@/features/library/viewer/DocFooter";
import { DocTitleMeta } from "@/features/library/viewer/DocTitleMeta";
import { DocToc } from "@/features/library/viewer/DocToc";
import { DocTree } from "@/features/library/viewer/DocTree";
import { MetaBar } from "@/features/library/viewer/MetaBar";
import { SectionBody } from "@/features/library/viewer/SectionBody";
import { useActiveAnchor } from "@/features/library/viewer/use-active-anchor";
import { useDoc, useOutline } from "@/features/library/viewer/use-doc-data";
import {
  FONT_SIZE_PX,
  LINE_HEIGHT_VALUE,
  useViewerSettings,
} from "@/features/settings/viewer-settings";
import { useNow } from "@/hooks/use-now";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { OutlineHeading } from "@/lib/bindings/OutlineHeading";
import { assetGet, errorMessage, openExternal } from "@/lib/tauri";

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
// アンカーへ移ったとき、見出しを本文の上端にぴったり付けず少し余白を空ける
const SCROLL_MARGIN_PX = 16;
const RESCROLL_WINDOW_MS = 2000;

export function DocPage(): JSX.Element {
  const { id = "" } = useParams();
  const load = useDoc(id);
  const outline = useOutline();
  const now = useNow();

  switch (load.status) {
    case "loading":
      return (
        <div className="flex flex-col gap-3 p-6">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    case "not_found":
      return (
        <DocMessage
          title="マニュアルが見つかりません"
          description="アプリの更新で削除されたか、リンクが古くなっている可能性があります。"
        />
      );
    case "error":
      return <DocMessage title="マニュアルを読み込めませんでした" description={load.message} />;
    case "ready":
      return <DocViewer doc={load.doc} outline={outline} now={now} />;
  }
}

function DocMessage({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" nativeButton={false} render={<Link to="/library" />}>
            ライブラリへ戻る
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

interface DocViewerProps {
  doc: DocDetail;
  outline: readonly DocOutline[];
  now: Date;
}

function DocViewer({ doc, outline, now }: DocViewerProps): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const settings = useViewerSettings((s) => s.settings);
  const [notice, setNotice] = useState<string | null>(null);

  // 本文のスクロールは中央の列だけで行う（ツリーと目次は動かさない）。スクロールの位置はこの要素で読む
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const viewport = useMemo(
    () => scrollRoot?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null,
    [scrollRoot],
  );

  const articleRef = useRef<HTMLElement>(null);
  const headingElsRef = useRef(new Map<string, HTMLElement>());
  const headingOf = useCallback((anchor: string) => headingElsRef.current.get(anchor), []);
  const registerHeading = useCallback((anchor: string, el: HTMLElement | null) => {
    if (el === null) {
      return undefined;
    }
    headingElsRef.current.set(anchor, el);
    return () => {
      headingElsRef.current.delete(anchor);
    };
  }, []);

  const tocHeadings = useMemo<OutlineHeading[]>(
    () =>
      doc.sections
        .filter((s) => s.level >= 1 && s.level <= 3)
        .map((s) => ({ level: s.level, title: s.title, anchor: s.anchor })),
    [doc.sections],
  );
  // モジュール・タグ・古い内容の警告は、原稿の最初の h1（文書のタイトル）の直下に出す。h1 がなければ本文の先頭
  const titleSectionId = doc.sections.find((s) => s.level === 1)?.id ?? null;
  const anchors = useMemo(() => tocHeadings.map((h) => h.anchor), [tocHeadings]);

  const assetCache = useMemo(() => {
    const mimes = new Map(doc.assets.map((a) => [a.id, a.mime]));
    return new AssetUrlCache(assetGet, (assetId) => mimes.get(assetId));
  }, [doc.assets]);
  // 別の文書へ移るときと画面を離れるときに Blob URL を解放する（残すとメモリに溜まり続けるため）
  useEffect(
    () => () => {
      assetCache.revokeAll();
    },
    [assetCache],
  );
  const resolveAsset = useCallback((assetId: string) => assetCache.get(assetId), [assetCache]);

  // URL のアンカー（ツリー・目次・内部リンクで変わる）の見出しへ移る。同じアンカーを 2 回押しても移るよう location.key も見る
  const hashAnchor = decodeAnchor(location.hash.replace(/^#/, ""));
  const activeAnchor = useActiveAnchor(
    viewport,
    anchors,
    headingOf,
    hashAnchor === "" ? null : hashAnchor,
  );
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (viewport === null || article === null) {
      return undefined;
    }
    const heading = hashAnchor === "" ? undefined : headingElsRef.current.get(hashAnchor);
    // ビューポートの位置は本文の外の要素なので、React の描画ではなくここで動かす
    const scroll = (): void => {
      viewport.scrollTo({
        top:
          heading === undefined
            ? 0
            : heading.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top +
              viewport.scrollTop -
              SCROLL_MARGIN_PX,
      });
    };
    scroll();
    if (heading === undefined) {
      return undefined;
    }
    // 画像は後から読み込まれて本文が伸びる。スクロールの上限で途中に止まったままにならないよう、
    // 利用者が自分でスクロールするまで（長くても少しの間）本文の高さが変わるたびに合わせ直す
    const observer = new ResizeObserver(scroll);
    observer.observe(article);
    const stop = (): void => {
      observer.disconnect();
    };
    const timer = window.setTimeout(stop, RESCROLL_WINDOW_MS);
    const userEvents = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const type of userEvents) {
      viewport.addEventListener(type, stop, { once: true, passive: true });
    }
    return () => {
      stop();
      window.clearTimeout(timer);
      for (const type of userEvents) {
        viewport.removeEventListener(type, stop);
      }
    };
  }, [viewport, doc.id, hashAnchor, location.key]);

  // 本文のリンクはまとめてここで受け、WebView の中では遷移させない（外部のページを開かせないため）
  function handleBodyClick(event: MouseEvent<HTMLElement>): void {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link === null) {
      return;
    }
    event.preventDefault();
    const target = resolveLink(link.getAttribute("href") ?? "");
    switch (target.kind) {
      case "external":
        setNotice(null);
        openExternal(target.url).catch((error: unknown) => {
          setNotice(`リンクを開けませんでした: ${errorMessage(error)}`);
        });
        return;
      case "anchor":
        setNotice(null);
        void navigate(docHref(doc.id, target.anchor));
        return;
      case "doc": {
        const found = outline.find((d) => d.sourcePath === manualSourcePath(target.fileName));
        if (found === undefined) {
          setNotice(`リンク先のマニュアルが見つかりません: ${target.fileName}`);
          return;
        }
        setNotice(null);
        void navigate(docHref(found.id, target.anchor));
        return;
      }
      case "unknown":
        setNotice("このリンクは開けません。");
        return;
    }
  }

  // 中クリックは click ではなく auxclick で届き、WebView2 では新しいウィンドウが開いてしまうので止める
  function handleBodyAuxClick(event: MouseEvent<HTMLElement>): void {
    if (event.target instanceof Element && event.target.closest("a[href]") !== null) {
      event.preventDefault();
    }
  }

  return (
    // ツリーと目次は、ウィンドウではなくこの領域の幅で出し分ける（アプリのサイドバーの開閉で幅が変わるため）
    <div className="@container flex h-full min-h-0">
      <aside className="hidden w-60 shrink-0 border-r @5xl:block">
        <ScrollArea className="h-full">
          <DocTree outline={outline} currentId={doc.id} />
        </ScrollArea>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MetaBar
          title={doc.title}
          notice={notice}
          onDismissNotice={() => {
            setNotice(null);
          }}
        />
        <ScrollArea ref={setScrollRoot} className="min-h-0 flex-1">
          <article
            ref={articleRef}
            className="manual-body mx-auto max-w-3xl px-8 py-6"
            style={{
              fontSize: `${String(FONT_SIZE_PX[settings.fontSize])}px`,
              lineHeight: LINE_HEIGHT_VALUE[settings.lineHeight],
            }}
            onClick={handleBodyClick}
            onAuxClick={handleBodyAuxClick}
          >
            {titleSectionId === null && <DocTitleMeta meta={doc.meta} now={now} />}
            {doc.sections.map((section) => (
              <section key={section.id}>
                {section.level > 0 && (
                  <SectionHeading
                    level={section.level}
                    anchor={section.anchor}
                    title={section.title}
                    register={registerHeading}
                  />
                )}
                {section.id === titleSectionId && <DocTitleMeta meta={doc.meta} now={now} />}
                {section.html !== "" && (
                  <SectionBody html={section.html} resolveAsset={resolveAsset} />
                )}
              </section>
            ))}
            <DocFooter meta={doc.meta} now={now} />
          </article>
        </ScrollArea>
      </div>
      <aside className="hidden w-56 shrink-0 border-l @3xl:block">
        <ScrollArea className="h-full">
          <DocToc docId={doc.id} headings={tocHeadings} activeAnchor={activeAnchor} />
        </ScrollArea>
      </aside>
    </div>
  );
}

interface SectionHeadingProps {
  level: number;
  anchor: string;
  title: string;
  register: (anchor: string, el: HTMLElement | null) => (() => void) | undefined;
}

function SectionHeading({ level, anchor, title, register }: SectionHeadingProps): JSX.Element {
  const Tag = HEADING_TAGS[Math.min(Math.max(level, 1), HEADING_TAGS.length) - 1] ?? "h6";
  return (
    <Tag ref={(el: HTMLHeadingElement | null) => register(anchor, el)} data-anchor={anchor}>
      {title}
    </Tag>
  );
}
