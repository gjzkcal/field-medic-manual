import {
  ArrowUpIcon,
  ChevronDownIcon,
  ImageIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type Ref,
  type SyntheticEvent,
  type JSX,
} from "react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  AI_EFFORT_LABELS,
  AI_EFFORT_RECOMMENDED,
  AI_EFFORTS,
  AI_MODEL_LABELS,
  AI_MODELS,
  isAiEffort,
  isAiModel,
  useAiSettings,
} from "@/features/chat/ai-settings";
import type { PreparedImage } from "@/features/chat/chat-store";
import { isAcceptedImage, MAX_IMAGES, prepareImage } from "@/features/chat/image-prepare";
import { errorMessage } from "@/lib/tauri";

/** 質問の長さの上限（Rust の上限と同じ） */
export const MAX_QUESTION_CHARS = 4000;

export interface ChatPromptInputHandle {
  focus: () => void;
}

interface ChatPromptInputProps {
  busy: boolean;
  /** AI が聞き返していて、入力欄の文を答えとして送るとき */
  answering: boolean;
  /** 会話の途中で設定を変えた（次の会話から効く） */
  settingsPending: boolean;
  onSend: (text: string, images: PreparedImage[]) => void;
  onStop: () => void;
  ref?: Ref<ChatPromptInputHandle>;
}

/** 質問の入力欄。Enter で送り、Shift+Enter で改行する。画像は貼り付け・ドラッグ・ボタンで付ける。 */
export function ChatPromptInput({
  busy,
  answering,
  settingsPending,
  onSend,
  onStop,
  ref,
}: ChatPromptInputProps): JSX.Element {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const settings = useAiSettings((s) => s.settings);
  const update = useAiSettings((s) => s.update);
  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  // 回答の途中でも、聞き返しへの答えは送れる
  const canSend = text.trim() !== "" && (!busy || answering);

  async function addFiles(files: readonly File[]): Promise<void> {
    setError(null);
    const accepted = files.filter((file) => isAcceptedImage(file));
    if (accepted.length < files.length) {
      setError("PNG・JPEG・WebP の画像だけを付けられます");
    }
    const room = MAX_IMAGES - images.length;
    if (accepted.length > room) {
      setError(`画像は ${String(MAX_IMAGES)} 枚までです`);
    }
    try {
      const prepared = await Promise.all(
        accepted.slice(0, Math.max(0, room)).map((file) => prepareImage(file)),
      );
      setImages((current) => [...current, ...prepared].slice(0, MAX_IMAGES));
    } catch (e: unknown) {
      setError(`画像を読めませんでした: ${errorMessage(e)}`);
    }
  }

  function removeImage(index: number): void {
    setImages((current) => {
      const removed = current[index];
      if (removed !== undefined) {
        URL.revokeObjectURL(removed.view.url);
      }
      return current.filter((_, i) => i !== index);
    });
  }

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    if (!canSend) {
      return;
    }
    onSend(text.trim(), answering ? [] : images);
    setText("");
    if (!answering) {
      // 送った画像の Blob URL は会話の表示が持つので、ここでは解放しない
      setImages([]);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function handleDrop(event: DragEvent<HTMLFormElement>): void {
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 画像のドロップを受ける。キーボードでは「画像を付ける」ボタンと貼り付けで同じことができる
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={handleDrop}
      className="flex flex-col gap-1.5"
    >
      <InputGroup>
        {images.length > 0 && (
          <InputGroupAddon align="block-start">
            <AttachmentGroup>
              {images.map((image, index) => (
                <Attachment key={image.view.url} size="xs">
                  <AttachmentMedia variant="image">
                    <img src={image.view.url} alt="" />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{image.view.name}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`${image.view.name} を外す`}
                      onClick={() => {
                        removeImage(index);
                      }}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={textareaRef}
          value={text}
          maxLength={MAX_QUESTION_CHARS}
          aria-label={answering ? "AI への答え" : "AI への質問"}
          placeholder={
            answering
              ? "選択肢にない答えを書く…"
              : "例: TQ はどこに巻く？（Enter で送信、Shift+Enter で改行）"
          }
          onChange={(event) => {
            setText(event.target.value);
          }}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            // 日本語の変換を確定する Enter では送らない
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          className="max-h-40 min-h-16 p-3"
        />
        <InputGroupAddon align="block-end">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <InputGroupButton
            size="icon-sm"
            variant="ghost"
            aria-label="画像を付ける"
            disabled={answering || images.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </InputGroupButton>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <InputGroupButton
                  size="sm"
                  variant="ghost"
                  aria-label={`モデルと Effort: ${AI_MODEL_LABELS[settings.model]}、${AI_EFFORT_LABELS[settings.effort]}`}
                  className="ml-auto"
                />
              }
            >
              {AI_MODEL_LABELS[settings.model].replace("Claude ", "")}・
              {AI_EFFORT_LABELS[settings.effort]}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>モデル</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.model}
                  onValueChange={(value: unknown) => {
                    if (isAiModel(value)) {
                      update({ model: value });
                    }
                  }}
                >
                  {AI_MODELS.map((model) => (
                    <DropdownMenuRadioItem key={model} value={model} closeOnClick>
                      {AI_MODEL_LABELS[model]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Effort（考える量）</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.effort}
                  onValueChange={(value: unknown) => {
                    if (isAiEffort(value)) {
                      update({ effort: value });
                    }
                  }}
                >
                  {AI_EFFORTS.map((effort) => (
                    <DropdownMenuRadioItem key={effort} value={effort} closeOnClick>
                      {AI_EFFORT_LABELS[effort]}
                      {effort === AI_EFFORT_RECOMMENDED[settings.model] ? "（推奨）" : ""}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {busy && !answering ? (
            <InputGroupButton
              size="icon-sm"
              variant="default"
              className="rounded-full"
              aria-label="回答を止める"
              onClick={onStop}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="rounded-full"
              aria-label={answering ? "答えを送る" : "質問を送る"}
              disabled={!canSend}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      {settingsPending && (
        <p className="text-xs text-muted-foreground">
          モデルと Effort の変更は、新しい会話から使われます
        </p>
      )}
      {error !== null && (
        <p role="alert" className="flex items-center gap-1 text-xs text-destructive">
          <ImageIcon className="size-3.5" aria-hidden />
          {error}
        </p>
      )}
    </form>
  );
}
