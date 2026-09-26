import { cn } from "cn";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { hitKey, searchKind } from "@/features/search/kinds";
import { toQueryFilter, useSearchFilter } from "@/features/search/search-filter";
import { SearchFilterPopover } from "@/features/search/SearchFilterPopover";
import { SnippetText } from "@/features/search/SnippetText";
import type { SearchHit } from "@/lib/bindings/SearchHit";
import { errorMessage, searchQuery } from "@/lib/tauri";

/** 打ち終わるのを待つ時間。1 文字ごとに IPC と DB を走らせず、かつ待たされたと感じない長さ */
export const SEARCH_DEBOUNCE_MS = 100;
const RESULT_LIMIT = 30;
// Base UI のポップアップ（絞り込み）は body 直下に描かれ、パレットの DOM の外になる
const POPUP_SELECTOR = "[data-slot=popover-content]";

type ResultState =
  { status: "idle" } | { status: "ok"; hits: SearchHit[] } | { status: "error"; message: string };

export interface CommandPaletteProps {
  /**
   * inline: 入力欄の下に一覧を常に出す（Step 08 の小窓）。
   * dropdown: 入力欄だけを置き、フォーカスしている間だけ一覧を下に重ねて出す（メインウィンドウの上部の検索欄）
   */
  variant?: "inline" | "dropdown";
  /** 外から入力欄にフォーカスするため（Ctrl+K） */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** 結果を選んだとき。開く先の URL を渡すので、置き場所（上部の検索欄、Step 08 の小窓）が遷移する */
  onSelect: (href: string, hit: SearchHit) => void;
  /** Ctrl+Enter。お気に入りへの追加（Step 08 で有効にする）。省略時は何もしない */
  onFavorite?: (hit: SearchHit) => void;
  /** 入力が空のときに出す中身（最近見たもの。Step 08）。省略時は使い方の案内 */
  emptySlot?: ReactNode;
  className?: string;
}

/**
 * 横断検索のパレット。ルーターに依存せず、上部の検索欄にも小窓にも置ける。
 * 絞り込みは全体で 1 つ（保存される）なので、置き場所が違っても同じ条件で探す。
 */
export function CommandPalette({
  variant = "inline",
  inputRef,
  onSelect,
  onFavorite,
  emptySlot,
  className,
}: CommandPaletteProps): JSX.Element {
  const dropdown = variant === "dropdown";
  const ownInputRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInputRef;
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResultState>({ status: "idle" });
  const [selected, setSelected] = useState("");
  const filter = useSearchFilter((s) => s.filter);
  const queryFilter = useMemo(() => toQueryFilter(filter), [filter]);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed === "") {
      return undefined;
    }
    // 打ち続けている間の古い応答で、新しい結果を上書きしないため
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchQuery(trimmed, { limit: RESULT_LIMIT, filter: queryFilter }).then(
        (hits) => {
          if (!cancelled) {
            setResult({ status: "ok", hits });
            // 結果が変わったら先頭を選び直す（前の結果の項目を選んだまま Enter で開かないため）
            setSelected(hits[0] === undefined ? "" : hitKey(hits[0]));
          }
        },
        (error: unknown) => {
          if (!cancelled) {
            setResult({ status: "error", message: errorMessage(error) });
          }
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, queryFilter]);

  // 一覧の外を押したら閉じる。絞り込みのポップオーバーは body 直下に出るので、その中を押しても閉じない
  useEffect(() => {
    if (!dropdown || !expanded) {
      return undefined;
    }
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (rootRef.current?.contains(target) !== true && target.closest(POPUP_SELECTOR) === null) {
        setExpanded(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [dropdown, expanded]);

  const hits = trimmed !== "" && result.status === "ok" ? result.hits : [];
  const showList = !dropdown || expanded;

  function collapse(): void {
    setExpanded(false);
    input.current?.blur();
  }

  function select(hit: SearchHit): void {
    if (dropdown) {
      // 開いたあとは本文を読むので、入力欄を空にしてフォーカスを外す（キー操作を本文へ返すため）
      setQuery("");
      collapse();
    }
    onSelect(searchKind(hit.kind).href(hit), hit);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // ポップオーバーの中のキーも React の木を伝ってここへ届く。一覧の操作や閉じる処理は、パレット本体のキーだけで行う
    if (!(event.target instanceof Node) || rootRef.current?.contains(event.target) !== true) {
      return;
    }
    if (event.key === "Escape" && dropdown) {
      event.preventDefault();
      collapse();
      return;
    }
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    // cmdk は修飾キーを見ずに Enter で開いてしまうので、先に止める
    event.preventDefault();
    if (event.nativeEvent.isComposing) {
      return;
    }
    const hit = hits.find((h) => hitKey(h) === selected);
    if (hit !== undefined) {
      onFavorite?.(hit);
    }
  }

  const list = (
    <>
      <CommandList className="max-h-[min(60vh,32rem)] pt-1">
        {trimmed === "" ? (
          (emptySlot ?? <EmptyHint />)
        ) : (
          <SearchResults result={result} hits={hits} query={trimmed} onSelect={select} />
        )}
      </CommandList>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 pt-1.5 text-xs text-muted-foreground">
        <KeyHint keys={["↑", "↓"]} label="選択" />
        <KeyHint keys={["Enter"]} label="開く" />
        {onFavorite !== undefined && <KeyHint keys={["Ctrl", "Enter"]} label="お気に入り" />}
        <KeyHint keys={["Esc"]} label="閉じる" />
        <div className="ml-auto">
          <SearchFilterPopover />
        </div>
      </div>
    </>
  );

  return (
    <Command
      ref={rootRef}
      label="マニュアルを検索"
      // 結果は Rust の全文検索で並べ済みなので、cmdk のあいまい絞り込みと並べ替えを止める
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      onKeyDown={handleKeyDown}
      className={cn(
        "rounded-none!",
        // 一覧を入力欄の下へはみ出させるので、生成コードの overflow-hidden と背景を外す
        dropdown && "relative size-auto overflow-visible bg-transparent p-0",
        className,
      )}
    >
      <div
        className={cn(
          "relative *:data-[slot=command-input-wrapper]:flex-1",
          dropdown && "*:data-[slot=command-input-wrapper]:p-0",
        )}
      >
        <CommandInput
          ref={input}
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            setExpanded(true);
          }}
          onFocus={() => {
            setExpanded(true);
          }}
          placeholder={dropdown ? "マニュアルを検索" : "マニュアルを検索（1 文字から）"}
        />
        {dropdown && !expanded && query === "" && (
          // 押す前から、ここに打てることと Ctrl+K でも来られることを示す
          <KbdGroup className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        )}
      </div>
      {showList &&
        (dropdown ? (
          <div className="absolute top-full left-1/2 z-50 mt-2 flex w-[max(100%,36rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-xl bg-popover p-1 pb-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
            {list}
          </div>
        ) : (
          list
        ))}
    </Command>
  );
}

interface SearchResultsProps {
  result: ResultState;
  hits: readonly SearchHit[];
  query: string;
  onSelect: (hit: SearchHit) => void;
}

function SearchResults({ result, hits, query, onSelect }: SearchResultsProps): JSX.Element | null {
  switch (result.status) {
    // 最初の結果が届くまでは何も出さない（100ms ほどなので「検索中」を出すとかえってちらつく）
    case "idle":
      return null;
    case "error":
      return (
        <p className="px-3 py-6 text-center text-sm text-destructive">
          検索できませんでした: {result.message}
        </p>
      );
    case "ok":
      return (
        <>
          <CommandEmpty>「{query}」に一致する項目はありません</CommandEmpty>
          {hits.map((hit) => (
            <HitItem key={hitKey(hit)} hit={hit} onSelect={onSelect} />
          ))}
        </>
      );
  }
}

function HitItem({
  hit,
  onSelect,
}: {
  hit: SearchHit;
  onSelect: (hit: SearchHit) => void;
}): JSX.Element {
  const kind = searchKind(hit.kind);
  const badge = kind.badge(hit);
  return (
    <CommandItem
      value={hitKey(hit)}
      onSelect={() => {
        onSelect(hit);
      }}
      // 生成コードは選択の印（チェック）を末尾に置くが、検索結果には使わないので隠す
      className="items-start gap-3 py-2 [&>svg:last-child]:hidden"
    >
      <kind.icon aria-hidden className="mt-0.5 text-muted-foreground" />
      <span className="sr-only">{kind.label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{hit.title}</span>
          {badge !== null && (
            <Badge variant="secondary" className="shrink-0">
              {badge}
            </Badge>
          )}
          <span className="ml-auto max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
            {kind.context(hit)}
          </span>
        </div>
        <p className="line-clamp-2">
          <SnippetText snippet={hit.snippet} />
        </p>
      </div>
    </CommandItem>
  );
}

function EmptyHint(): JSX.Element {
  return (
    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
      語を入力すると、マニュアルの節とトリアージのフローを探します。空白で区切ると、すべての語を含むものに絞ります。
    </p>
  );
}

function KeyHint({ keys, label }: { keys: readonly string[]; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <KbdGroup>
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
      {label}
    </span>
  );
}
