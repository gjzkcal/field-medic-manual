import { CheckIcon, KeyRoundIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAiKey } from "@/features/chat/ai-key";
import {
  AI_EFFORT_LABELS,
  AI_EFFORTS,
  AI_MODEL_DESCRIPTIONS,
  AI_MODEL_LABELS,
  AI_MODELS,
  useAiSettings,
} from "@/features/chat/ai-settings";
import { aiKeyCheck, errorMessage, openExternal } from "@/lib/tauri";

const CONSOLE_URL = "https://platform.claude.com/settings/keys";

type Feedback = { kind: "ok" | "error"; text: string } | null;

/** AI チャットの API キー・モデル・Effort。キーの登録を、送る内容と課金への同意とみなすので、注意はここに書く。 */
export function AiSettingsCard(): JSX.Element {
  const status = useAiKey((s) => s.status);
  const refresh = useAiKey((s) => s.refresh);
  const save = useAiKey((s) => s.save);
  const clear = useAiKey((s) => s.clear);
  const settings = useAiSettings((s) => s.settings);
  const update = useAiSettings((s) => s.update);
  const storageError = useAiSettings((s) => s.storageError);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(action: () => Promise<void>, done: string): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ kind: "ok", text: done });
    } catch (error: unknown) {
      setFeedback({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="ai">
      <CardHeader>
        <CardTitle>
          <h2>AI チャット</h2>
        </CardTitle>
        <CardDescription>
          上の帯の「AI に質問」から、マニュアルを根拠に AI（Anthropic の
          Claude）に質問できます。使うには、自分の Anthropic の API キーを登録します。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <KeyRoundIcon className="size-4" aria-hidden />
            API キー
            <span className="font-normal text-muted-foreground">
              {status === null
                ? ""
                : status === "set"
                  ? "（登録済み）"
                  : status === "missing"
                    ? "（未登録）"
                    : "（資格情報マネージャーを使えません）"}
            </span>
          </span>
          <form
            className="flex max-w-xl flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = key;
              void act(async () => {
                await save(value);
                setKey("");
              }, "API キーを登録しました");
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="Anthropic の API キー"
              placeholder="sk-ant-…"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
              }}
              className="min-w-48 flex-1"
            />
            <Button type="submit" disabled={busy || key.trim() === ""}>
              登録する
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || status !== "set"}
              onClick={() => {
                void act(() => aiKeyCheck(settings.model), "接続できました");
              }}
            >
              接続を確認
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || status !== "set"}
              onClick={() => {
                void act(clear, "API キーを削除しました");
              }}
            >
              キーを削除
            </Button>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                void openExternal(CONSOLE_URL);
              }}
            >
              API キーを作る（Anthropic の Console）
            </Button>
          </div>
          {feedback !== null && (
            <p
              role={feedback.kind === "error" ? "alert" : "status"}
              className={
                feedback.kind === "error"
                  ? "text-sm text-destructive"
                  : "flex items-center gap-1 text-sm text-muted-foreground"
              }
            >
              {feedback.kind === "ok" && <CheckIcon className="size-4" aria-hidden />}
              {feedback.text}
            </p>
          )}
          <ul className="flex max-w-2xl list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            <li>
              キーは Windows の資格情報マネージャーに保存します。アプリの画面やログには出しません。
            </li>
            <li>
              質問の文、付けた画像、AI が読んだマニュアルの節、使っている MOD の組み合わせが
              Anthropic に送られます。
              スクリーンショットにプレイヤー名などが写っていないか確かめてください。
            </li>
            <li>
              知らない語の意味を調べるとき、AI は Anthropic を通して ACE の公式の文書・リポジトリと
              Bohemia の Wiki だけを Web 検索します。
            </li>
            <li>
              利用料は、キーの持ち主（あなた）に課金されます。キーを登録すると、これらに同意したものとします。
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">モデル</span>
          <ToggleGroup
            variant="outline"
            size="sm"
            aria-label="モデル"
            value={[settings.model]}
            onValueChange={(values) => {
              const next = AI_MODELS.find((v) => values.includes(v));
              if (next !== undefined) {
                update({ model: next });
              }
            }}
          >
            {AI_MODELS.map((model) => (
              <ToggleGroupItem key={model} value={model}>
                {AI_MODEL_LABELS[model].replace("Claude ", "")}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {AI_MODEL_DESCRIPTIONS[settings.model]}。単価（入力 / 出力、100 万トークンあたり）は
            2026 年 10 月時点の目安です。
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Effort（考える量）</span>
          <ToggleGroup
            variant="outline"
            size="sm"
            aria-label="Effort"
            value={[settings.effort]}
            onValueChange={(values) => {
              const next = AI_EFFORTS.find((v) => values.includes(v));
              if (next !== undefined) {
                update({ effort: next });
              }
            }}
          >
            {AI_EFFORTS.map((effort) => (
              <ToggleGroupItem key={effort} value={effort}>
                {AI_EFFORT_LABELS[effort]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            高いほど考える量が増え、時間と費用が増えます。モデルと Effort
            の変更は、新しい会話から使われます。
          </p>
        </div>
        {storageError !== null && (
          <p role="alert" className="text-sm text-destructive">
            設定を保存できませんでした: {storageError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
