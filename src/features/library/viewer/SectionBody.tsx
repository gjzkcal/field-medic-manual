import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { createPortal } from "react-dom";

import { sanitizeToFragment } from "@/features/content/sanitize";
import { hideModColumns } from "@/features/library/viewer/mod-columns";
import type { ActiveMods } from "@/features/triage/runner";
import { IS_WEB } from "@/lib/platform";

// Recharts と形の検査（zod）は大きいので、グラフのある節を開くまで読み込まない（起動を遅くしないため）
const EmbeddedChart = lazy(() =>
  import("@/features/library/viewer/EmbeddedChart").then((m) => ({ default: m.EmbeddedChart })),
);
// 配置に使う dagre と形の検査も、図のある節を開くまで読み込まない
const EmbeddedFlowchart = lazy(() =>
  import("@/features/library/viewer/EmbeddedFlowchart").then((m) => ({
    default: m.EmbeddedFlowchart,
  })),
);

/**
 * 最初の描画が画面に出た後に true になる。図の部品を、本文の文が見えてから読み始めるために使う
 * （本文を描いている最中に読み始めると、回線と CPU を本文と取り合い、文が出るのが遅れる）
 */
function useAfterFirstPaint(enabled: boolean): boolean {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    // NOTE: 描画の後を知る API は無いので、requestAnimationFrame を 2 回重ねる。
    // 1 回目のコールバックは今回の描画の直前に、その中で予約した 2 回目は次の描画の直前に走るので、
    // 2 回目が走るときには、今回の描画（本文の文）は画面に出ている
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setPainted(true);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return painted;
}

interface SectionBodyProps {
  html: string;
  /** asset id から表示用の URL を得る */
  resolveAsset: (assetId: string) => Promise<string>;
  /** 表の組み合わせの列をこの MOD で絞る。null ならすべての列を出す */
  active: ActiveMods | null;
}

// data-chart・data-flowchart の中身は、ここでは読まずに文字列のまま渡す。
// 形の検査（zod）を、図を描く部品と一緒に後から読むため（ここで読むと、図の無い原稿でも最初の JS に zod が入る）
interface ChartMount {
  host: HTMLElement;
  json: string;
  /** 表の直前に描くグラフか（表なしのグラフでなければ true） */
  withTable: boolean;
}

interface FlowchartMount {
  host: HTMLElement;
  json: string;
}

/**
 * 節の本文。表示の直前にもう一度無害化し、innerHTML を使わずに DOM として差し込む。
 * 画像は `data-asset-id` だけで保存しているので、ここで Blob URL を付ける。
 * `data-chart` の付いた表は、表の直前にグラフを描く（表は残す）。表なしのグラフは `data-chart` の付いた figure に描く。
 * `data-mod-columns` の付いた表は、設定の MOD に合わない組み合わせの列を消す。
 * `data-flowchart` の付いた figure にはフローチャートを描く。描けないときは、figure の中の文のリストがそのまま見える。
 * グラフとフローチャートは、形の検査も含めて後から読む部品が描く。形が合わなければ、その部品が置き場所を隠す。
 */
export function SectionBody({ html, resolveAsset, active }: SectionBodyProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // 表の名前にする段落の id。同じ文書に節がいくつも並ぶので、節ごとに違う接頭辞にする
  const baseId = useId();

  // グラフの置き場所（表の直前の figure か、表なしのグラフの figure）は、描画の前に本文の DOM の中に作っておき、React からはポータルで描く。
  // 差し込む前に作るのは、差し込んだ後に state を更新するともう一度描画が要り、アンカーへのスクロールがずれるため
  const { nodes, charts, flowcharts } = useMemo(() => {
    const fragment = sanitizeToFragment(html);
    if (active !== null) {
      for (const table of Array.from(
        fragment.querySelectorAll<HTMLTableElement>("table[data-mod-columns]"),
      )) {
        hideModColumns(table, active);
      }
    }
    const mounts: ChartMount[] = [];
    for (const marked of Array.from(
      fragment.querySelectorAll<HTMLElement>("table[data-chart], figure[data-chart]"),
    )) {
      const isTable = marked instanceof HTMLTableElement;
      let host = marked;
      if (isTable) {
        host = marked.ownerDocument.createElement("figure");
        marked.before(host);
      }
      host.className = "manual-chart";
      mounts.push({ host, json: marked.dataset["chart"] ?? "", withTable: isTable });
    }
    const flowchartMounts: FlowchartMount[] = [];
    for (const figure of Array.from(
      fragment.querySelectorAll<HTMLElement>("figure[data-flowchart]"),
    )) {
      // 文のリストは検索と読み上げのために残すので、図は figure の先頭に別の置き場所を作って描く
      const host = figure.ownerDocument.createElement("div");
      host.className = "manual-flowchart-canvas";
      figure.prepend(host);
      figure.classList.add("manual-flowchart");
      flowchartMounts.push({ host, json: figure.dataset["flowchart"] ?? "" });
    }
    nameTables(fragment, baseId);
    markExternalLinks(fragment);
    // 開発時の StrictMode では effect が 2 回走るので、fragment ではなく節の子の一覧を持ち、何度でも差し込めるようにする
    return { nodes: Array.from(fragment.childNodes), charts: mounts, flowcharts: flowchartMounts };
  }, [html, active, baseId]);

  const drawFigures = useAfterFirstPaint(charts.length > 0 || flowcharts.length > 0);

  // 描画の前に差し込み、アンカーへのスクロールが本文の高さの揃った状態で行われるようにする
  useLayoutEffect(() => {
    const container = ref.current;
    if (container === null) {
      return;
    }
    container.replaceChildren(...nodes);
    // 横にはみ出す表・式・コードは、キーボードでもスクロールできるようにする。幅は文字の大きさや窓の幅で変わるので、変わるたびに見直す。
    // NOTE: ここで幅を読まず、ResizeObserver の通知（監視を始めた直後にも 1 回来る）で、通知された箱だけを調べる。
    // 差し込んだ直後に読むと、節の数だけ本文全体のレイアウトをやり直し、長い原稿を開くたびに画面が固まる。
    // 画面の外の節は .manual-section-body の content-visibility でレイアウトを後回しにしていて、通知は描くときに来る
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          markScrollable(entry.target);
        }
      }
    });
    for (const el of Array.from(container.querySelectorAll<HTMLElement>(SCROLLER_SELECTOR))) {
      resize.observe(el);
    }
    const loading = new AbortController();
    for (const img of Array.from(
      container.querySelectorAll<HTMLImageElement>("img[data-asset-id]"),
    )) {
      const assetId = img.dataset["assetId"] ?? "";
      resolveAsset(assetId).then(
        (url) => {
          if (!loading.signal.aborted) {
            img.setAttribute("src", url);
          }
        },
        () => {
          if (!loading.signal.aborted) {
            img.replaceWith(missingImage(img.getAttribute("alt") ?? ""));
          }
        },
      );
    }
    return () => {
      loading.abort();
      resize.disconnect();
    };
  }, [nodes, resolveAsset]);

  return (
    <>
      <div ref={ref} className="manual-section-body" />
      {drawFigures &&
        charts.map(({ host, json, withTable }, i) =>
          createPortal(
            <Suspense fallback={null}>
              <EmbeddedChart host={host} json={json} withTable={withTable} />
            </Suspense>,
            host,
            `chart-${String(i)}`,
          ),
        )}
      {drawFigures &&
        flowcharts.map(({ host, json }, i) =>
          createPortal(
            <Suspense fallback={null}>
              <EmbeddedFlowchart host={host} json={json} />
            </Suspense>,
            host,
            `flowchart-${String(i)}`,
          ),
        )}
    </>
  );
}

/**
 * アプリの外で開くリンクに、開き方を足す（デスクトップ版は既定のブラウザ、Web 版は新しいタブ）。
 * 押すと画面が切り替わるので、押す前に分かるようにする。見た目の印は index.css の .manual-external-link
 */
function markExternalLinks(fragment: DocumentFragment): void {
  for (const link of Array.from(fragment.querySelectorAll("a[href]"))) {
    // 相対パスのリンクはアプリの中で開くので印を付けない
    // i と u を一緒に付けると ſ（U+017F）が s に当たり、`httpſ:` も外のリンクになる。大文字小文字は文字クラスで書く
    if (!/^[Hh][Tt]{2}[Pp][Ss]?:/u.test(link.getAttribute("href") ?? "")) {
      continue;
    }
    const note = link.ownerDocument.createElement("span");
    note.className = "sr-only";
    note.textContent = IS_WEB ? "（新しいタブで開く）" : "（ブラウザで開く）";
    link.append(note);
    link.classList.add("manual-external-link");
  }
}

// 本文の CSS（index.css）で横にスクロールさせている箱
const SCROLLER_SELECTOR = "table, pre, .manual-math";

/**
 * はみ出している箱だけを Tab で止まるようにする（WCAG 2.1.1）。表は 1 つの原稿に 10 を超えることがあり、
 * 収まっている箱まで止めると Tab の回数が増えるだけなので外す。コードの箱には役割がないので、止めるときに名前を付ける
 */
function markScrollable(el: HTMLElement): void {
  const scrollable = el.scrollWidth > el.clientWidth + 1;
  if (scrollable) {
    el.tabIndex = 0;
    if (el.localName === "pre") {
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", "コード");
    }
  } else if (el.hasAttribute("tabindex")) {
    el.removeAttribute("tabindex");
    if (el.localName === "pre") {
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    }
  }
}

/** 表の名前にする段落。原稿は「…の推移:」のように、表の前の 1 文で何の表かを書いている */
const TABLE_LEAD = /[:：]\s*$/u;

/**
 * 表の直前の「…:」で終わる段落を、表の名前にする（WCAG 1.3.1）。読み上げで表へ跳んだときに、何の表かが分かるようにする。
 * 表の直前にグラフを描くときは、その figure を挟んでいてもよい
 */
function nameTables(fragment: DocumentFragment, baseId: string): void {
  for (const [index, table] of Array.from(fragment.querySelectorAll("table")).entries()) {
    let lead = table.previousElementSibling;
    if (lead?.classList.contains("manual-chart") === true) {
      lead = lead.previousElementSibling;
    }
    if (lead?.localName !== "p" || !TABLE_LEAD.test(lead.textContent)) {
      continue;
    }
    if (lead.id === "") {
      lead.id = `${baseId}-table-${String(index)}`;
    }
    table.setAttribute("aria-labelledby", lead.id);
  }
}

function missingImage(alt: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "manual-missing-image";
  span.textContent = alt === "" ? "［画像を表示できません］" : `［画像を表示できません: ${alt}］`;
  return span;
}
