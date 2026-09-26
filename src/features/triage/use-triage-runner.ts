// ランナーの状態を URL の ?path= に持たせる。小窓（Step 08）とメインの画面で同じ URL を開けば続きから進められるようにするため。
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import {
  formatPath,
  parsePath,
  replay,
  type FlowLookup,
  type RunnerState,
} from "@/features/triage/runner";
import type { Flow } from "@/features/triage/schema";

export const PATH_PARAM = "path";

export interface TriageRunner {
  state: RunnerState;
  /** 今のノードの選択肢（番号は RunnerState.options の添字）を選ぶ */
  choose: (index: number) => void;
  back: () => void;
  restart: () => void;
  /** 経路の k 歩目（パンくずの k 番目）のノードに戻る */
  jumpTo: (step: number) => void;
}

export function useTriageRunner(root: Flow, lookup: FlowLookup): TriageRunner {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPath = searchParams.get(PATH_PARAM);
  const state = useMemo(() => replay(root, lookup, parsePath(rawPath)), [root, lookup, rawPath]);

  const go = useCallback(
    (path: readonly number[]) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (path.length === 0) {
            next.delete(PATH_PARAM);
          } else {
            next.set(PATH_PARAM, formatPath(path));
          }
          return next;
        },
        // 1 歩ごとに履歴を積むと、ウィンドウの「戻る」がフローの外へ出るまでに何度も押すことになるため置き換える
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const { path, options } = state;
  return {
    state,
    choose: useCallback(
      (index: number) => {
        if (index >= 0 && index < options.length) {
          go([...path, index]);
        }
      },
      [go, path, options.length],
    ),
    back: useCallback(() => {
      go(path.slice(0, -1));
    }, [go, path]),
    restart: useCallback(() => {
      go([]);
    }, [go]),
    jumpTo: useCallback(
      (step: number) => {
        go(path.slice(0, step));
      },
      [go, path],
    ),
  };
}
