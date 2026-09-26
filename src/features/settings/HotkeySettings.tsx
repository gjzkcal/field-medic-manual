import { KeyboardIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useState, type JSX, type KeyboardEvent } from "react";

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
        <CardTitle>ホットキー</CardTitle>
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
  const inputId = `hotkey-${binding.action}`;

  function apply(accelerator: string): void {
    hotkeySet(binding.action, accelerator).then(
      () => {
        setMessage(null);
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
    event.preventDefault();
    if (event.key === "Escape") {
      event.currentTarget.blur();
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
        event.currentTarget.blur();
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
      <p className="text-xs text-muted-foreground">{text.description}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64 max-w-full">
          <KeyboardIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            readOnly
            className="pl-8 font-mono"
            value={recording ? "" : displayAccelerator(binding.accelerator)}
            placeholder="組み合わせを押してください"
            aria-invalid={error !== null}
            onFocus={() => {
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
            }}
          >
            <RotateCcwIcon />
            既定（{displayAccelerator(binding.defaultAccelerator)}）に戻す
          </Button>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
