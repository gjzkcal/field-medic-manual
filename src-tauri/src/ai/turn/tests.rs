use std::collections::VecDeque;
use std::sync::Mutex;

use bytes::Bytes;
use serde_json::json;

use super::*;
use crate::ai::corpus::fixtures;
use crate::ai::types::{AiEffort, AiModel, ClientRequest};

/// 決まった応答を順に返す送信。送った本文を覚えておき、テストで中身を確かめる。
#[derive(Default)]
struct FakeTransport {
    responses: Mutex<VecDeque<Result<Vec<String>, SendFailure>>>,
    bodies: Mutex<Vec<Value>>,
}

impl FakeTransport {
    fn with(responses: Vec<Result<Vec<String>, SendFailure>>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            bodies: Mutex::new(Vec::new()),
        }
    }

    fn bodies(&self) -> Vec<Value> {
        self.bodies.lock().expect("ロックできる").clone()
    }
}

impl Transport for FakeTransport {
    fn send(&self, body: Value) -> impl Future<Output = Result<ByteStream, SendFailure>> + Send {
        self.bodies.lock().expect("ロックできる").push(body);
        let next = self
            .responses
            .lock()
            .expect("ロックできる")
            .pop_front()
            .expect("用意した応答が足りない");
        std::future::ready(next.map(|chunks| -> ByteStream {
            Box::pin(futures_util::stream::iter(
                chunks.into_iter().map(|c| Ok(Bytes::from(c))),
            ))
        }))
    }
}

fn sse(data: &Value) -> String {
    let kind = data["type"].as_str().unwrap_or_default().to_owned();
    format!("event: {kind}\ndata: {data}\n\n")
}

fn start() -> String {
    sse(
        &json!({"type":"message_start","message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":100,"cache_read_input_tokens":50,"output_tokens":1}}}),
    )
}

fn stop(reason: &str) -> Vec<String> {
    vec![
        sse(
            &json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":5}}),
        ),
        sse(&json!({"type":"message_stop"})),
    ]
}

fn text_response(text: &str, reason: &str) -> Vec<String> {
    let mut chunks = vec![
        start(),
        sse(
            &json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        sse(
            &json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
        ),
        sse(&json!({"type":"content_block_stop","index":0})),
    ];
    chunks.extend(stop(reason));
    chunks
}

fn tool_response(id: &str, name: &str, input: &Value) -> Vec<String> {
    let mut chunks = vec![
        start(),
        sse(
            &json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}),
        ),
        sse(
            &json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"SIG"}}),
        ),
        sse(&json!({"type":"content_block_stop","index":0})),
        sse(
            &json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":id,"name":name,"input":{}}}),
        ),
        sse(
            &json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":input.to_string()}}),
        ),
        sse(&json!({"type":"content_block_stop","index":1})),
    ];
    chunks.extend(stop("tool_use"));
    chunks
}

fn failure(error: AppError, retryable: bool, web_search_disabled: bool) -> SendFailure {
    SendFailure {
        error,
        retryable,
        retry_after: Some(Duration::from_millis(1)),
        web_search_disabled,
    }
}

fn input(text: &str) -> ChatSendInput {
    ChatSendInput {
        text: text.to_owned(),
        images: Vec::new(),
        model: AiModel::ClaudeSonnet55,
        effort: AiEffort::Medium,
        mods: Vec::new(),
        replace_from: None,
    }
}

struct Env {
    state: Arc<AiState>,
    db: Db,
    _dir: tempfile::TempDir,
    events: Arc<Mutex<Vec<ChatEvent>>>,
}

impl Env {
    /// 原稿の読み込みを飛ばすため、会話を先に始めておく
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let db = Db::open(dir.path()).expect("DB を開ける");
        let state = Arc::new(AiState::default());
        let fixed = Fixed {
            model: AiModel::ClaudeSonnet55,
            effort: AiEffort::High,
            mods: Vec::new(),
            corpus: Arc::new(fixtures::corpus()),
            system: Arc::new("sys".to_owned()),
            web_search: true,
        };
        drop(state.begin(Some(fixed), None).expect("始められる"));
        Self {
            state,
            db,
            _dir: dir,
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn ask(
        &self,
        transport: &FakeTransport,
        input: ChatSendInput,
    ) -> Result<ChatTurnResult, AppError> {
        let events = Arc::clone(&self.events);
        let emit = move |e: ChatEvent| {
            events.lock().expect("ロックできる").push(e);
            true
        };
        run(&self.state, &self.db, transport, input, &emit).await
    }

    fn events(&self) -> Vec<ChatEvent> {
        self.events.lock().expect("ロックできる").clone()
    }

    fn history_len(&self) -> usize {
        self.state
            .begin(None, None)
            .expect("始められる")
            .messages
            .len()
    }
}

#[tokio::test]
async fn text_answer_is_kept_and_sent_back_next_time() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Ok(text_response("止血帯を巻きます", "end_turn")),
        Ok(text_response("はい", "end_turn")),
    ]);
    let first = env
        .ask(&transport, input("止血は？"))
        .await
        .expect("答える");
    assert_eq!(first.status, TurnStatus::Completed);
    assert_eq!(first.turn_index, Some(0));
    assert_eq!(first.usage.input_tokens, 100);
    assert_eq!(first.usage.cache_read_tokens, 50);
    assert!(env.events().contains(&ChatEvent::Text {
        block: 0,
        text: "止血帯を巻きます".to_owned()
    }));

    let second = env.ask(&transport, input("次は？")).await.expect("答える");
    assert_eq!(second.turn_index, Some(1));
    let bodies = transport.bodies();
    let messages = bodies[1]["messages"].as_array().expect("配列");
    assert_eq!(messages.len(), 3, "前の質問と答えを送り返す");
    assert_eq!(messages[1]["content"][0]["text"], "止血帯を巻きます");
    // 会話の設定は最初のものを使う（2 回目の入力の effort ではない）
    assert_eq!(bodies[1]["output_config"]["effort"], "high");
    assert_eq!(
        bodies[0]["system"][0]["text"],
        bodies[1]["system"][0]["text"]
    );
    assert_eq!(bodies[0]["tools"], bodies[1]["tools"]);
}

#[tokio::test]
async fn read_section_result_is_returned_as_search_results() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Ok(tool_response(
            "t1",
            "read_section",
            &json!({"source": "doc:hemorrhage.md#止血帯を使う"}),
        )),
        Ok(text_response("巻きます", "end_turn")),
    ]);
    let result = env.ask(&transport, input("止血帯")).await.expect("答える");
    assert_eq!(result.status, TurnStatus::Completed);
    let bodies = transport.bodies();
    let messages = bodies[1]["messages"].as_array().expect("配列");
    // user・assistant（thinking と tool_use）・user（tool_result）
    assert_eq!(messages.len(), 3);
    assert_eq!(
        messages[1]["content"][0]["signature"], "SIG",
        "thinking をそのまま送り返す"
    );
    let tool_result = &messages[2]["content"][0];
    assert_eq!(tool_result["tool_use_id"], "t1");
    assert_eq!(tool_result["content"][0]["type"], "search_result");
    assert_eq!(
        tool_result["content"][0]["source"],
        "doc:hemorrhage.md#止血帯を使う"
    );
    let states: Vec<ToolState> = env
        .events()
        .into_iter()
        .filter_map(|e| match e {
            ChatEvent::ToolActivity { state, .. } => Some(state),
            _ => None,
        })
        .collect();
    assert_eq!(states, vec![ToolState::Running, ToolState::Done]);
    // 2 回目の応答のブロックは、1 回目の 2 つの後ろから数える
    assert!(env.events().contains(&ChatEvent::Text {
        block: 2,
        text: "巻きます".to_owned()
    }));
}

#[tokio::test]
async fn search_manual_reports_no_hits_on_an_empty_db() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Ok(tool_response(
            "t1",
            "search_manual",
            &json!({"query": "止血", "include_other_mods": false}),
        )),
        Ok(text_response("載っていません", "end_turn")),
    ]);
    env.ask(&transport, input("止血")).await.expect("答える");
    let bodies = transport.bodies();
    let result = &bodies[1]["messages"][2]["content"][0];
    assert!(
        result["content"][0]["text"]
            .as_str()
            .is_some_and(|t| t.contains("見つかりませんでした"))
    );
}

async fn wait_for_request(env: &Env) -> String {
    loop {
        let found = env.events().into_iter().find_map(|e| match e {
            ChatEvent::ClientRequest { tool_use_id, .. } => Some(tool_use_id),
            _ => None,
        });
        if let Some(id) = found {
            return id;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test]
async fn ask_user_waits_for_the_answer() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Ok(tool_response(
            "t1",
            "ask_user",
            &json!({"question": "呼吸は？", "options": ["ある", "ない"], "multi_select": false}),
        )),
        Ok(text_response("回復体位に", "end_turn")),
    ]);
    let (result, ()) = tokio::join!(env.ask(&transport, input("意識がない")), async {
        let id = wait_for_request(&env).await;
        env.state
            .resolve_pending(
                &id,
                ClientToolResult::AskUser {
                    answer: "ある".to_owned(),
                },
            )
            .expect("渡せる");
    });
    assert_eq!(result.expect("答える").status, TurnStatus::Completed);
    assert!(env.events().iter().any(|e| matches!(
        e,
        ChatEvent::ClientRequest { request: ClientRequest::AskUser { question, .. }, .. } if question == "呼吸は？"
    )));
    let bodies = transport.bodies();
    assert_eq!(
        bodies[1]["messages"][2]["content"][0]["content"][0]["text"],
        "利用者の答え: ある"
    );
}

#[tokio::test]
async fn cancel_while_waiting_discards_the_turn() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![Ok(tool_response(
        "t1",
        "ask_user",
        &json!({"question": "呼吸は？", "options": ["ある", "ない"], "multi_select": false}),
    ))]);
    let (result, ()) = tokio::join!(env.ask(&transport, input("意識がない")), async {
        wait_for_request(&env).await;
        env.state.cancel().expect("止められる");
    });
    let result = result.expect("止めたのは失敗ではない");
    assert_eq!(result.status, TurnStatus::Cancelled);
    assert_eq!(result.turn_index, None);
    assert_eq!(env.history_len(), 0, "止めた質問は会話に残らない");
}

#[tokio::test]
async fn refusal_is_not_kept() {
    let env = Env::new();
    let mut chunks = vec![start()];
    chunks.push(sse(&json!({"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"type":"refusal","category":"bio","explanation":"x"}}})));
    chunks.push(sse(&json!({"type":"message_stop"})));
    let transport = FakeTransport::with(vec![Ok(chunks)]);
    let result = env
        .ask(&transport, input("?"))
        .await
        .expect("拒否は失敗ではない");
    assert_eq!(
        result.status,
        TurnStatus::Refused {
            category: Some("bio".to_owned()),
            explanation: Some("x".to_owned())
        }
    );
    assert_eq!(env.history_len(), 0);
}

#[tokio::test]
async fn retryable_failures_are_sent_again() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Err(failure(AppError::Overloaded("x".to_owned()), true, false)),
        Ok(text_response("ok", "end_turn")),
    ]);
    let result = env
        .ask(&transport, input("?"))
        .await
        .expect("送り直して答える");
    assert_eq!(result.status, TurnStatus::Completed);
    assert_eq!(transport.bodies().len(), 2);
}

#[tokio::test]
async fn other_failures_are_returned() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![Err(failure(
        AppError::AiAuth("bad".to_owned()),
        false,
        false,
    ))]);
    assert!(matches!(
        env.ask(&transport, input("?")).await,
        Err(AppError::AiAuth(_))
    ));
    assert_eq!(env.history_len(), 0);
}

#[tokio::test]
async fn web_search_is_dropped_when_the_organization_disabled_it() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Err(failure(
            AppError::AiRequest("not enabled".to_owned()),
            false,
            true,
        )),
        Ok(text_response("ok", "end_turn")),
        Ok(text_response("ok", "end_turn")),
    ]);
    env.ask(&transport, input("?"))
        .await
        .expect("Web 検索なしで答える");
    env.ask(&transport, input("?")).await.expect("次も答える");
    let bodies = transport.bodies();
    let has_web = |body: &Value| {
        body["tools"]
            .as_array()
            .is_some_and(|l| l.iter().any(|t| t["name"] == WEB_SEARCH))
    };
    assert!(has_web(&bodies[0]));
    assert!(!has_web(&bodies[1]));
    assert!(!has_web(&bodies[2]), "会話の間は外したまま");
    assert!(env.events().contains(&ChatEvent::Notice {
        notice: ChatNotice::WebSearchDisabled
    }));
}

#[tokio::test]
async fn cut_stream_is_a_network_error() {
    let env = Env::new();
    let mut chunks = text_response("途中", "end_turn");
    chunks.pop();
    let transport = FakeTransport::with(vec![Ok(chunks)]);
    assert!(matches!(
        env.ask(&transport, input("?")).await,
        Err(AppError::Network(_))
    ));
    assert_eq!(env.history_len(), 0);
}

#[tokio::test]
async fn error_event_in_the_stream_is_overloaded() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![Ok(vec![
        start(),
        sse(&json!({"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}})),
    ])]);
    assert!(matches!(
        env.ask(&transport, input("?")).await,
        Err(AppError::Overloaded(_))
    ));
}

#[tokio::test]
async fn max_tokens_text_is_kept_as_truncated() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![Ok(text_response("途中まで", "max_tokens"))]);
    let result = env
        .ask(&transport, input("?"))
        .await
        .expect("途中まで答える");
    assert_eq!(result.status, TurnStatus::Truncated);
    assert_eq!(env.history_len(), 2);
}

#[tokio::test]
async fn tool_rounds_are_limited() {
    let env = Env::new();
    let call = json!({"source": "doc:hemorrhage.md#包帯"});
    let mut responses: Vec<Result<Vec<String>, SendFailure>> = (0..MAX_TOOL_ROUNDS)
        .map(|i| Ok(tool_response(&format!("t{i}"), "read_section", &call)))
        .collect();
    responses.push(Ok(text_response("ここまでで答えます", "end_turn")));
    let transport = FakeTransport::with(responses);
    let result = env.ask(&transport, input("?")).await.expect("答える");
    assert_eq!(result.status, TurnStatus::Completed);
    let bodies = transport.bodies();
    let last = bodies.last().expect("ある");
    assert_eq!(last["tool_choice"], json!({"type": "none"}));
    assert!(
        bodies[..bodies.len() - 1]
            .iter()
            .all(|b| b.get("tool_choice").is_none())
    );
    assert!(env.events().contains(&ChatEvent::Notice {
        notice: ChatNotice::ToolLimitReached
    }));
}

#[tokio::test]
async fn editing_a_question_resends_from_there() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Ok(text_response("a1", "end_turn")),
        Ok(text_response("a2", "end_turn")),
        Ok(text_response("a1b", "end_turn")),
    ]);
    env.ask(&transport, input("q1")).await.expect("答える");
    env.ask(&transport, input("q2")).await.expect("答える");
    let mut edit = input("q1b");
    edit.replace_from = Some(0);
    let result = env.ask(&transport, edit).await.expect("答える");
    assert_eq!(result.turn_index, Some(0));
    let bodies = transport.bodies();
    let messages = bodies[2]["messages"].as_array().expect("配列");
    assert_eq!(messages.len(), 1, "編集した質問より後ろは送らない");
    assert_eq!(messages[0]["content"][0]["text"], "q1b");
    assert_eq!(env.history_len(), 2);
}

#[tokio::test]
async fn pause_turn_is_continued() {
    let env = Env::new();
    let transport = FakeTransport::with(vec![
        Ok(text_response("調べています", "pause_turn")),
        Ok(text_response("分かりました", "end_turn")),
    ]);
    let result = env.ask(&transport, input("?")).await.expect("答える");
    assert_eq!(result.status, TurnStatus::Completed);
    let bodies = transport.bodies();
    let messages = bodies[1]["messages"].as_array().expect("配列");
    assert_eq!(messages.len(), 2, "止まった応答をそのまま送り返して続ける");
    assert_eq!(messages[1]["role"], "assistant");
}

#[tokio::test]
async fn parallel_tool_results_go_in_one_message_in_order() {
    let env = Env::new();
    let call = |index: u32, id: &str, name: &str, input: &Value| {
        vec![
            sse(
                &json!({"type":"content_block_start","index":index,"content_block":{"type":"tool_use","id":id,"name":name,"input":{}}}),
            ),
            sse(
                &json!({"type":"content_block_delta","index":index,"delta":{"type":"input_json_delta","partial_json":input.to_string()}}),
            ),
            sse(&json!({"type":"content_block_stop","index":index})),
        ]
    };
    let mut chunks = vec![start()];
    chunks.extend(call(
        0,
        "a",
        "read_section",
        &json!({"source": "doc:hemorrhage.md#包帯"}),
    ));
    chunks.extend(call(
        1,
        "b",
        "read_section",
        &json!({"source": "doc:nothing.md#x"}),
    ));
    chunks.extend(stop("tool_use"));
    let transport = FakeTransport::with(vec![Ok(chunks), Ok(text_response("ok", "end_turn"))]);
    env.ask(&transport, input("?")).await.expect("答える");
    let bodies = transport.bodies();
    let messages = bodies[1]["messages"].as_array().expect("配列");
    assert_eq!(messages.len(), 3, "結果は 1 つの user メッセージにまとめる");
    let results = messages[2]["content"].as_array().expect("配列");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["tool_use_id"], "a");
    assert_eq!(results[1]["tool_use_id"], "b");
    assert_eq!(
        results[1]["is_error"],
        json!(true),
        "見つからない節もエラーとして必ず返す"
    );
}

#[tokio::test]
async fn tool_use_without_client_calls_is_continued() {
    let env = Env::new();
    let mut only_server = vec![
        start(),
        sse(
            &json!({"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"s1","name":"web_search","input":{}}}),
        ),
        sse(
            &json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"TQ\"}"}}),
        ),
        sse(&json!({"type":"content_block_stop","index":0})),
    ];
    only_server.extend(stop("tool_use"));
    let transport = FakeTransport::with(vec![
        Ok(only_server),
        Ok(text_response("止血帯のことです", "end_turn")),
    ]);
    let result = env
        .ask(&transport, input("TQ って？"))
        .await
        .expect("答える");
    assert_eq!(result.status, TurnStatus::Completed);
    let bodies = transport.bodies();
    let messages = bodies[1]["messages"].as_array().expect("配列");
    assert_eq!(messages.len(), 2, "空の tool_result を送らない");
    assert_eq!(messages[1]["content"][0]["input"]["query"], "TQ");
    assert!(env.events().contains(&ChatEvent::ToolActivity {
        id: "s1".to_owned(),
        tool: ToolKind::WebSearch,
        detail: "TQ".to_owned(),
        state: ToolState::Running
    }));
}

#[test]
fn images_are_checked() {
    let png = base64::engine::general_purpose::STANDARD
        .encode([0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]);
    let ok = ChatImage {
        media_type: ImageMediaType::Png,
        data: png.clone(),
    };
    assert!(check_input("これは？", std::slice::from_ref(&ok)).is_ok());
    let wrong_type = ChatImage {
        media_type: ImageMediaType::Jpeg,
        data: png,
    };
    assert!(check_input("x", &[wrong_type]).is_err());
    let broken = ChatImage {
        media_type: ImageMediaType::Png,
        data: "!!!".to_owned(),
    };
    assert!(check_input("x", &[broken]).is_err());
    assert!(check_input("x", &[ok.clone(), ok.clone(), ok.clone(), ok]).is_err());
    assert!(check_input("", &[]).is_err());
    assert!(check_input(&"あ".repeat(MAX_TEXT_CHARS + 1), &[]).is_err());
}

#[test]
fn webp_is_detected() {
    let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
    webp.push(0);
    assert_eq!(detect_image(&webp), Some(ImageMediaType::Webp));
    assert_eq!(
        detect_image(&[0xFF, 0xD8, 0xFF, 0xE0]),
        Some(ImageMediaType::Jpeg)
    );
    assert_eq!(detect_image(b"GIF89a"), None);
}
