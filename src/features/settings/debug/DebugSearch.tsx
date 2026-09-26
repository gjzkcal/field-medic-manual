import { useEffect, useState, type JSX } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SnippetText } from "@/features/search/SnippetText";
import type { ModChannel } from "@/lib/bindings/ModChannel";
import type { ModTarget } from "@/lib/bindings/ModTarget";
import type { SearchFilter } from "@/lib/bindings/SearchFilter";
import type { SearchHit } from "@/lib/bindings/SearchHit";
import { errorMessage, searchQuery } from "@/lib/tauri";

// Record にしておくと、Rust 側で値が増えたときに表示名の書き漏れがコンパイルエラーになる
const MOD_TARGET_LABELS: Record<ModTarget, string> = {
  core: "Core",
  hitzones: "Hitzones",
  circulation: "Circulation",
  breathing: "Breathing",
  defibrillation: "Defibrillation",
  ai: "AI",
  general: "一般",
};
const MOD_CHANNEL_LABELS: Record<ModChannel, string> = { release: "Release", dev: "Dev" };

const MOD_TARGETS: readonly ModTarget[] = [
  "core",
  "hitzones",
  "circulation",
  "breathing",
  "defibrillation",
  "ai",
  "general",
];
const MOD_CHANNELS: readonly ModChannel[] = ["release", "dev"];

type SearchState =
  | { status: "idle" }
  | { status: "ok"; hits: SearchHit[]; elapsedMs: number }
  | { status: "error"; message: string };

interface DebugSearchProps {
  /** 変わったら検索し直す（データを投入・削除したとき） */
  revision: number;
}

export function DebugSearch({ revision }: DebugSearchProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [modTargets, setModTargets] = useState<ModTarget[]>([]);
  const [modChannel, setModChannel] = useState<ModChannel | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    const filter: SearchFilter = {};
    if (modTargets.length > 0) {
      filter.modTargets = modTargets;
    }
    if (modChannel !== null) {
      filter.modChannel = modChannel;
    }
    const tags = tagsText.split(/[\s,、]+/u).filter((t) => t !== "");
    if (tags.length > 0) {
      filter.tags = tags;
    }
    // 性能の目安（1000 節で 100ms 以内）を確かめるため、IPC を含めた 1 回の検索の時間を出す
    const started = performance.now();
    searchQuery(query, { filter })
      .then((hits) => {
        if (!cancelled) {
          setState({ status: "ok", hits, elapsedMs: performance.now() - started });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, modTargets, modChannel, tagsText, revision]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">簡易検索</h3>
      <Input
        placeholder="例: 止血帯 / 出血 / CPR / TQ"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">モジュール</span>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          value={modTargets}
          onValueChange={(values) => {
            // ToggleGroup は string[] を返すので、既知の値だけを残して型を戻す
            setModTargets(MOD_TARGETS.filter((t) => values.includes(t)));
          }}
        >
          {MOD_TARGETS.map((t) => (
            <ToggleGroupItem key={t} value={t}>
              {MOD_TARGET_LABELS[t]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">版</span>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={modChannel === null ? [] : [modChannel]}
          onValueChange={(values) => {
            setModChannel(MOD_CHANNELS.find((c) => values.includes(c)) ?? null);
          }}
        >
          {MOD_CHANNELS.map((c) => (
            <ToggleGroupItem key={c} value={c}>
              {MOD_CHANNEL_LABELS[c]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Input
          className="ml-2 max-w-60"
          placeholder="タグ（空白・カンマ区切り）"
          value={tagsText}
          onChange={(e) => {
            setTagsText(e.target.value);
          }}
        />
      </div>
      <SearchResults state={state} />
    </section>
  );
}

function SearchResults({ state }: { state: SearchState }): JSX.Element | null {
  switch (state.status) {
    case "idle":
      return null;
    case "error":
      return <p className="text-sm text-destructive">{state.message}</p>;
    case "ok":
      if (state.hits.length === 0) {
        return (
          <p className="text-sm text-muted-foreground">該当なし（{formatMs(state.elapsedMs)}）</p>
        );
      }
      return (
        <ul className="flex flex-col gap-2">
          <li className="text-xs text-muted-foreground">
            {state.hits.length} 件（{formatMs(state.elapsedMs)}）
          </li>
          {state.hits.map((hit) => (
            <li
              key={`${hit.kind}:${String(hit.id)}`}
              className="flex flex-col gap-1 rounded-lg border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{hit.documentTitle} ›</span>
                <span className="font-medium">{hit.title}</span>
                {hit.synonymOnly && <Badge variant="secondary">同義語</Badge>}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  score {hit.score.toFixed(2)}
                </span>
              </div>
              <SnippetText snippet={hit.snippet} />
            </li>
          ))}
        </ul>
      );
  }
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}
