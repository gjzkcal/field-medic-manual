import { KeyboardIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { acceleratorFromKey, displayAccelerator } from "@/features/settings/hotkey-recorder";
import type { HotkeyAction } from "@/lib/bindings/HotkeyAction";
import type { HotkeyBinding } from "@/lib/bindings/HotkeyBinding";
import { errorMessage, hotkeyList, hotkeySet } from "@/lib/tauri";

const ACTION_TEXT: Record<HotkeyAction, { label: string; description: string }> = {
  toggle: {
    label: "小窓の表示 / 非表示",
    description: "フォーカスを移さずに出すので、ゲームの操作は止まりません。",
  },
  search: {
    label: "小窓で検索",
    description: "小窓を出して検索欄に移ります（打てるように、ゲームからフォーカスが外れます）。",
  },
  triage: {
    label: "小窓でトリアージ",
    description:
      "最後に開いたフローを最初から開きます（数字キーで選べるよう、フォーカスを移します）。",
  },
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; bindings: HotkeyBinding[] }
  | { status: "error"; message: string };

/** ホットキーの設定。変えるとすぐ登録し直し、再起動後も残る（Rust が DB から読んで登録する）。 */
export function HotkeySettings(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const reload = useCallback(() => {
    hotkeyList().then(
      (bindings) => {
        setState({ status: "ready", bindings });
      },
      (error: unknown) => {
        setState({ status: "error", message: errorMessage(error) });
      },
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>ホットキー</h2>
        </CardTitle>
        <CardDescription>
          ゲーム中でも効くキーです。欄を押してから、新しい組み合わせを押してください（Esc
          で取り消し）。いま割り当てているキーや、ほかのアプリが使っているキーは、押しても欄に入りません。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === "loading" && <p className="text-sm text-muted-foreground">読み込み中…</p>}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            ホットキーの設定を読み込めませんでした: {state.message}
          </p>
        )}
        {state.status === "ready" &&
          state.bindings.map((binding) => (
            <HotkeyRow key={binding.action} binding={binding} onChanged={reload} />
          ))}
      </CardContent>
    </Card>
  );
}

function HotkeyRow({
  binding,
  onChanged,
}: {
  binding: HotkeyBinding;
  onChanged: () => void;
}): JSX.Element {
  const text = ACTION_TEXT[binding.action];
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 変えられたことを読み上げで伝える（欄の値が変わるだけでは気づけない）
  const [done, setDone] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // スクリプトで欄へ戻したときは記録を始めない（「既定に戻す」の後など）
  const skipRecordRef = useRef(false);
  const inputId = `hotkey-${binding.action}`;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;

  function apply(accelerator: string): void {
    setDone("");
    hotkeySet(binding.action, accelerator).then(
      () => {
        setMessage(null);
        setDone(`「${text.label}」を ${displayAccelerator(accelerator)} にしました`);
        onChanged();
      },
      (error: unknown) => {
        setMessage(errorMessage(error));
        onChanged();
      },
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Tab") {
      // フォーカスの移動はそのまま通す（キーボードだけで設定画面を操作できるように）
      return;
    }
    if (!recording) {
      // 記録を終えた後も欄に残るので、Enter か Space で記録し直せるようにする
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setRecording(true);
      }
      return;
    }
    event.preventDefault();
    // 記録を終えても欄からフォーカスを外さない（外すと body に落ち、Tab で先頭からたどり直すことになる）
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    const result = acceleratorFromKey(event.nativeEvent);
    switch (result.kind) {
      case "pending":
        return;
      case "invalid":
        setMessage(result.reason);
        return;
      case "ok":
        setRecording(false);
        if (result.accelerator !== binding.accelerator) {
          apply(result.accelerator);
        }
        return;
    }
  }

  // 起動時の登録の失敗（ほかのアプリが使っているなど）は、ここで変えるまで出し続ける
  const error = message ?? binding.error;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {text.label}
      </label>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {text.description}
        {/* 読み取り専用の欄に見えるので、押した組み合わせを記録する欄だと読み上げで伝える */}
        <span className="sr-only">
          欄で組み合わせを押すと記録します。Esc で取り消し、Enter で記録し直します。
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64 max-w-full">
          <KeyboardIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            id={inputId}
            readOnly
            aria-describedby={error === null ? descriptionId : `${descriptionId} ${errorId}`}
            className="pl-8 font-mono"
            value={recording ? "" : displayAccelerator(binding.accelerator)}
            placeholder="組み合わせを押してください"
            aria-invalid={error !== null}
            onFocus={() => {
              if (skipRecordRef.current) {
                skipRecordRef.current = false;
                return;
              }
              setRecording(true);
            }}
            onBlur={() => {
              setRecording(false);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        {binding.accelerator !== binding.defaultAccelerator && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              apply(binding.defaultAccelerator);
              // このボタンは既定に戻ると消えるので、フォーカスを欄へ移す
              skipRecordRef.current = true;
              inputRef.current?.focus();
            }}
          >
            <RotateCcwIcon />
            既定（{displayAccelerator(binding.defaultAccelerator)}）に戻す
          </Button>
        )}
      </div>
      {error !== null && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="sr-only">
        {done}
      </p>
    </div>
  );
}
