//! 質問 1 回分の往復。API を呼び、ツールを実行し、答えが出るまで繰り返す。
//!
//! 履歴は追記だけにする。途中のターンを書き換えると thinking の署名が無効になり、次の要求が 400 になるため。
//! 失敗・キャンセル・拒否のときは、この質問の分を会話に残さない（`TurnGuard` を commit せずに落とす）。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::watch;

use crate::ai::claude::http::{ByteStream, SendFailure, Transport};
use crate::ai::claude::sse::{
    Delta, FinalMessage, INVALID_INPUT_MARK, MessageAccumulator, SseParser, StreamError,
};
use crate::ai::claude::{self, WEB_SEARCH};
use crate::ai::conversation::{AiState, Fixed};
use crate::ai::corpus::{self, Corpus};
use crate::ai::prompt;
use crate::ai::tools::{self, ASK_USER, READ_SECTION, SEARCH_MANUAL, ToolOutput};
use crate::ai::types::{
    ChatEvent, ChatImage, ChatNotice, ChatSendInput, ChatTurnResult, ChatUsage, ClientToolResult,
    ImageMediaType, ToolKind, ToolState, TurnStatus,
};
use crate::db::Db;
use crate::error::AppError;
use crate::model::ModTarget;

/// ツールの往復の上限。超えたらツールを使わせずに答えさせる（費用と待ち時間が際限なく増えないように）
const MAX_TOOL_ROUNDS: u32 = 6;
/// 聞き返しの上限（1 つの質問につき）
const MAX_ASKS: u32 = 2;
/// 送る前の失敗（混雑・接続できない）を送り直す回数
const MAX_RETRIES: u32 = 2;
const RETRY_BASE: Duration = Duration::from_secs(2);
/// 応答の断片が届かないまま待つ上限。考えている間も要約や ping が届くので、これだけ途切れたら切れたとみなす
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_mins(2);
const MAX_TEXT_CHARS: usize = 4000;
const MAX_ANSWER_CHARS: usize = 1000;
const MAX_IMAGES: usize = 3;
/// API の 1 枚あたりの上限
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// 質問を受け取って答えるまでを行う。
///
/// # Errors
///
/// 入力が不正なら `InvalidInput`。API の失敗は `AiAuth`・`Network`・`RateLimited`・`Overloaded`・`AiRequest`。
pub async fn run<T: Transport>(
    state: &Arc<AiState>,
    db: &Db,
    transport: &T,
    input: ChatSendInput,
    emit: &(dyn Fn(ChatEvent) -> bool + Send + Sync),
) -> Result<ChatTurnResult, AppError> {
    let text = input.text.trim().to_owned();
    check_input(&text, &input.images)?;
    let fixed = if state.has_conversation()? {
        None
    } else {
        Some(new_fixed(db, &input).await?)
    };
    let start = state.begin(fixed, input.replace_from)?;
    let mut run = Run {
        state,
        db,
        transport,
        emit,
        fixed: start.fixed,
        cancel: start.cancel,
        turn_id: start.guard.turn_id(),
        usage: ChatUsage::default(),
        block_offset: 0,
    };
    let mut messages = start.messages;
    let start_index = messages.len();
    messages.push(claude::user_message(&text, &input.images));
    match run.answer(&mut messages).await? {
        Outcome::Keep(status) => {
            let turn_index = start
                .guard
                .commit(messages, start_index, run.fixed.web_search)?;
            Ok(ChatTurnResult {
                status: if turn_index.is_some() {
                    status
                } else {
                    TurnStatus::Cancelled
                },
                usage: run.usage,
                turn_index,
            })
        }
        Outcome::Discard(status) => Ok(ChatTurnResult {
            status,
            usage: run.usage,
            turn_index: None,
        }),
    }
}

/// 会話の最初の質問のときに、原稿の写しと system プロンプトを作る。
async fn new_fixed(db: &Db, input: &ChatSendInput) -> Result<Fixed, AppError> {
    let corpus = db.run(|conn, _| corpus::load(conn)).await?;
    if corpus.docs.is_empty() {
        return Err(AppError::InvalidInput(
            "原稿の読み込みが終わっていません。少し待ってから送ってください".to_owned(),
        ));
    }
    let mut mods: Vec<ModTarget> = input.mods.clone();
    mods.sort_by_key(|m| m.as_str());
    mods.dedup();
    let system = prompt::system_prompt(&corpus, &mods);
    Ok(Fixed {
        model: input.model,
        effort: input.effort,
        mods,
        corpus: Arc::new(corpus),
        system: Arc::new(system),
        web_search: true,
    })
}

fn check_input(text: &str, images: &[ChatImage]) -> Result<(), AppError> {
    if text.is_empty() {
        return Err(AppError::InvalidInput("質問を入力してください".to_owned()));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::InvalidInput(format!(
            "質問は {MAX_TEXT_CHARS} 文字までにしてください"
        )));
    }
    if images.len() > MAX_IMAGES {
        return Err(AppError::InvalidInput(format!(
            "画像は {MAX_IMAGES} 枚までにしてください"
        )));
    }
    for image in images {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&image.data)
            .map_err(|_| AppError::InvalidInput("画像を読めません".to_owned()))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(AppError::InvalidInput(
                "画像が大きすぎます（1 枚 5MB まで）".to_owned(),
            ));
        }
        if detect_image(&bytes) != Some(image.media_type) {
            return Err(AppError::InvalidInput(
                "PNG・JPEG・WebP の画像だけを付けられます".to_owned(),
            ));
        }
    }
    Ok(())
}

/// 先頭のバイトで画像の形式を見分ける。画面が言う形式をそのまま信じないため。
fn detect_image(bytes: &[u8]) -> Option<ImageMediaType> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(ImageMediaType::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(ImageMediaType::Jpeg)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageMediaType::Webp)
    } else {
        None
    }
}

enum Outcome {
    /// 会話に残す
    Keep(TurnStatus),
    /// 会話に残さない
    Discard(TurnStatus),
}

/// 1 回の質問の間だけ使う状態。
struct Run<'a, T: Transport> {
    state: &'a Arc<AiState>,
    db: &'a Db,
    transport: &'a T,
    emit: &'a (dyn Fn(ChatEvent) -> bool + Send + Sync),
    fixed: Fixed,
    cancel: watch::Receiver<bool>,
    turn_id: u64,
    usage: ChatUsage,
    /// 画面のブロックの通し番号。API の応答ごとに 0 から振られるので、前の応答の分だけずらす
    block_offset: u32,
}

/// 応答を読んでいる途中で止まった理由。
enum Interrupted {
    Cancelled,
    Failed(AppError),
}

impl<T: Transport> Run<'_, T> {
    async fn answer(&mut self, messages: &mut Vec<Value>) -> Result<Outcome, AppError> {
        let mut tool_rounds = 0;
        let mut asks = 0;
        loop {
            let force = tool_rounds >= MAX_TOOL_ROUNDS;
            let message = match self.call(messages, force).await {
                Ok(m) => m,
                Err(Interrupted::Cancelled) => return Ok(Outcome::Discard(TurnStatus::Cancelled)),
                Err(Interrupted::Failed(e)) => return Err(e),
            };
            self.usage.add(claude::usage(&message.usage));
            self.emit_event(ChatEvent::Usage { usage: self.usage });
            self.block_offset += u32::try_from(message.content.len()).unwrap_or(0);
            let stop = message.stop_reason.as_deref().unwrap_or("end_turn");
            match stop {
                "refusal" => {
                    let field = |name: &str| {
                        message
                            .stop_details
                            .as_ref()
                            .and_then(|d| d.get(name))
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    };
                    return Ok(Outcome::Discard(TurnStatus::Refused {
                        category: field("category"),
                        explanation: field("explanation"),
                    }));
                }
                "max_tokens" => {
                    // ツールの呼び出しの途中で切れたものは送り返せない（tool_use に結果を付けられない）
                    if message.has_invalid_tool_input() || has_tool_use(&message.content) {
                        return Err(AppError::AiRequest(
                            "回答が長くなりすぎて途中で止まりました。質問を分けるか、Effort を下げてください".to_owned(),
                        ));
                    }
                    messages.push(claude::assistant_message(message.content));
                    return Ok(Outcome::Keep(TurnStatus::Truncated));
                }
                "pause_turn" => {
                    // サーバー側のツール（Web 検索）が長引いて止まった。そのまま送り返すと続きから進む
                    messages.push(claude::assistant_message(clean(message.content)));
                    tool_rounds += 1;
                }
                "tool_use" => {
                    let content = clean(message.content);
                    let calls: Vec<Value> = content
                        .iter()
                        .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
                        .cloned()
                        .collect();
                    messages.push(claude::assistant_message(content));
                    if calls.is_empty() {
                        // サーバー側のツール（Web 検索）だけが残っている。空の結果を送ると 400 になるので、
                        // pause_turn と同じくそのまま送り返して続けさせる
                        tool_rounds += 1;
                        continue;
                    }
                    let mut results = Vec::with_capacity(calls.len());
                    for call in &calls {
                        match self.run_tool(call, &mut asks).await {
                            Ok(block) => results.push(block),
                            Err(Interrupted::Cancelled) => {
                                return Ok(Outcome::Discard(TurnStatus::Cancelled));
                            }
                            Err(Interrupted::Failed(e)) => return Err(e),
                        }
                    }
                    tool_rounds += 1;
                    let limit = tool_rounds >= MAX_TOOL_ROUNDS;
                    if limit {
                        self.emit_event(ChatEvent::Notice {
                            notice: ChatNotice::ToolLimitReached,
                        });
                    }
                    messages.push(claude::tool_results_message(results, limit));
                }
                _ => {
                    messages.push(claude::assistant_message(clean(message.content)));
                    return Ok(Outcome::Keep(TurnStatus::Completed));
                }
            }
        }
    }

    /// API を 1 回呼び、応答を最後まで読む。
    async fn call(&mut self, messages: &[Value], force: bool) -> Result<FinalMessage, Interrupted> {
        let stream = self.send(messages, force).await?;
        self.read(stream).await
    }

    async fn send(&mut self, messages: &[Value], force: bool) -> Result<ByteStream, Interrupted> {
        let mut attempt = 0;
        loop {
            let tools = claude::tools(self.fixed.web_search);
            let body = claude::request_body(
                self.fixed.model,
                self.fixed.effort,
                &self.fixed.system,
                &tools,
                messages,
                force,
            );
            let failure: SendFailure = tokio::select! {
                result = self.transport.send(body) => match result {
                    Ok(stream) => return Ok(stream),
                    Err(f) => f,
                },
                () = cancelled(&mut self.cancel) => return Err(Interrupted::Cancelled),
            };
            // 最初の質問でだけ Web 検索を外して送り直せる。答えた後で tools を変えると、前の thinking の署名が無効になる
            if failure.web_search_disabled
                && self.fixed.web_search
                && !messages.iter().any(is_assistant)
            {
                self.fixed.web_search = false;
                self.emit_event(ChatEvent::Notice {
                    notice: ChatNotice::WebSearchDisabled,
                });
                continue;
            }
            if !failure.retryable || attempt >= MAX_RETRIES {
                return Err(Interrupted::Failed(failure.error));
            }
            attempt += 1;
            let wait = failure.retry_after.unwrap_or(RETRY_BASE * attempt);
            tokio::select! {
                () = tokio::time::sleep(wait) => {}
                () = cancelled(&mut self.cancel) => return Err(Interrupted::Cancelled),
            }
        }
    }

    async fn read(&mut self, mut stream: ByteStream) -> Result<FinalMessage, Interrupted> {
        let mut parser = SseParser::default();
        let mut acc = MessageAccumulator::default();
        loop {
            let next = tokio::select! {
                next = tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()) => next,
                () = cancelled(&mut self.cancel) => return Err(Interrupted::Cancelled),
            };
            let chunk = match next {
                Err(_) => {
                    return Err(Interrupted::Failed(AppError::Network(
                        "AI のサーバーからの応答が途切れました".to_owned(),
                    )));
                }
                Ok(None) => break,
                Ok(Some(Err(e))) => return Err(Interrupted::Failed(e)),
                Ok(Some(Ok(chunk))) => chunk,
            };
            for event in parser.push(&chunk) {
                let deltas = acc
                    .handle(&event)
                    .map_err(|e| Interrupted::Failed(stream_error(e)))?;
                for delta in deltas {
                    if !self.forward(delta) {
                        // 画面が閉じた。読み続けても見せる先がなく、課金だけが増える
                        return Err(Interrupted::Cancelled);
                    }
                }
            }
        }
        acc.finish()
            .map_err(|e| Interrupted::Failed(stream_error(e)))
    }

    /// 応答の断片を画面のイベントにする。画面に届かなくなったら false。
    fn forward(&self, delta: Delta) -> bool {
        let block = |index: usize| self.block_offset + u32::try_from(index).unwrap_or(0);
        let event = match delta {
            Delta::Text { index, text } => ChatEvent::Text {
                block: block(index),
                text,
            },
            Delta::Thinking { index, text } => ChatEvent::Thinking {
                block: block(index),
                text,
            },
            Delta::Citation { index, citation } => {
                let Some(citation) = claude::citation(&citation) else {
                    return true;
                };
                ChatEvent::Citation {
                    block: block(index),
                    citation,
                }
            }
            Delta::BlockStop { block: b, .. }
                if b.get("type").and_then(Value::as_str) == Some("server_tool_use")
                    && b.get("name").and_then(Value::as_str) == Some(WEB_SEARCH) =>
            {
                ChatEvent::ToolActivity {
                    id: str_of(&b, "id"),
                    tool: ToolKind::WebSearch,
                    detail: b
                        .get("input")
                        .and_then(|i| i.get("query"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    state: ToolState::Running,
                }
            }
            Delta::BlockStart { block: b, .. }
                if b.get("type").and_then(Value::as_str) == Some("web_search_tool_result") =>
            {
                // 失敗のときは content がエラーのオブジェクト、成功は結果の配列になる
                let failed = !b.get("content").is_some_and(Value::is_array);
                ChatEvent::ToolActivity {
                    id: str_of(&b, "tool_use_id"),
                    tool: ToolKind::WebSearch,
                    detail: String::new(),
                    state: if failed {
                        ToolState::Failed
                    } else {
                        ToolState::Done
                    },
                }
            }
            Delta::BlockStart { .. } | Delta::BlockStop { .. } => return true,
        };
        (self.emit)(event)
    }

    /// 自作のツールを 1 つ実行し、`tool_result` のブロックを返す。
    async fn run_tool(&mut self, call: &Value, asks: &mut u32) -> Result<Value, Interrupted> {
        let id = str_of(call, "id");
        let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
        let input = call.get("input").cloned().unwrap_or(Value::Null);
        let output = match name {
            SEARCH_MANUAL | READ_SECTION => {
                let (kind, detail_key) = if name == SEARCH_MANUAL {
                    (ToolKind::SearchManual, "query")
                } else {
                    (ToolKind::ReadSection, "source")
                };
                let detail = input
                    .get(detail_key)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                self.activity(&id, kind, &detail, ToolState::Running)?;
                let corpus: &Corpus = &self.fixed.corpus;
                let output = if name == SEARCH_MANUAL {
                    tools::search_manual(self.db, corpus, &self.fixed.mods, &input)
                        .await
                        .map_err(Interrupted::Failed)?
                } else {
                    tools::read_section(corpus, &input)
                };
                let state = if matches!(output, ToolOutput::Error(_)) {
                    ToolState::Failed
                } else {
                    ToolState::Done
                };
                self.activity(&id, kind, &detail, state)?;
                output
            }
            ASK_USER => self.ask(&id, &input, asks).await?,
            _ => ToolOutput::Error(format!("{name} というツールはありません")),
        };
        Ok(claude::tool_result(&id, &output))
    }

    async fn ask(
        &mut self,
        id: &str,
        input: &Value,
        asks: &mut u32,
    ) -> Result<ToolOutput, Interrupted> {
        if *asks >= MAX_ASKS {
            return Ok(ToolOutput::Error(format!(
                "聞き返しは 1 つの質問につき {MAX_ASKS} 回までです。ここまでに分かったことで答えてください"
            )));
        }
        let request = match tools::ask_user_request(input) {
            Ok(r) => r,
            Err(message) => return Ok(ToolOutput::Error(message)),
        };
        *asks += 1;
        let rx = self
            .state
            .register_pending(self.turn_id, id)
            .map_err(|_| Interrupted::Cancelled)?;
        if !(self.emit)(ChatEvent::ClientRequest {
            tool_use_id: id.to_owned(),
            request,
        }) {
            return Err(Interrupted::Cancelled);
        }
        let result = tokio::select! {
            r = rx => r.map_err(|_| Interrupted::Cancelled)?,
            () = cancelled(&mut self.cancel) => return Err(Interrupted::Cancelled),
        };
        let ClientToolResult::AskUser { answer } = result;
        let answer: String = answer.trim().chars().take(MAX_ANSWER_CHARS).collect();
        Ok(if answer.is_empty() {
            ToolOutput::Text("（利用者は答えませんでした）".to_owned())
        } else {
            ToolOutput::Text(format!("利用者の答え: {answer}"))
        })
    }

    fn activity(
        &self,
        id: &str,
        tool: ToolKind,
        detail: &str,
        state: ToolState,
    ) -> Result<(), Interrupted> {
        if (self.emit)(ChatEvent::ToolActivity {
            id: id.to_owned(),
            tool,
            detail: detail.to_owned(),
            state,
        }) {
            Ok(())
        } else {
            Err(Interrupted::Cancelled)
        }
    }

    /// 進み具合の知らせ。届かなくても回答は続ける（使用量や知らせは、結果にも残るため）。
    fn emit_event(&self, event: ChatEvent) {
        let _ = (self.emit)(event);
    }
}

/// キャンセルされるまで待つ。キャンセルの送り手が消えたときもキャンセルとみなす。
async fn cancelled(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
}

fn stream_error(e: StreamError) -> AppError {
    match e.error_type.as_str() {
        "overloaded_error" | "api_error" => AppError::Overloaded(e.message),
        "rate_limit_error" => AppError::RateLimited(e.message),
        "incomplete_stream" => AppError::Network(e.message),
        "authentication_error" | "permission_error" => AppError::AiAuth(e.message),
        _ => AppError::AiRequest(e.message),
    }
}

/// 送り返す前に、組み立てのときに付けた印を外す（API は知らないキーを 400 にする）。
fn clean(content: Vec<Value>) -> Vec<Value> {
    content
        .into_iter()
        .map(|mut block| {
            if let Some(obj) = block.as_object_mut() {
                obj.remove(INVALID_INPUT_MARK);
            }
            block
        })
        .collect()
}

fn has_tool_use(content: &[Value]) -> bool {
    content.iter().any(|b| {
        matches!(
            b.get("type").and_then(Value::as_str),
            Some("tool_use" | "server_tool_use")
        )
    })
}

fn is_assistant(message: &Value) -> bool {
    message.get("role").and_then(Value::as_str) == Some("assistant")
}

fn str_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests;
