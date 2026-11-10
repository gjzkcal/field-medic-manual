//! Messages API のストリーミング（SSE）の解釈と、届いた断片からのメッセージの組み立て。
//!
//! 組み立てたブロックは `serde_json::Value` のまま持ち、次の要求でそのまま送り返す。
//! thinking の `signature`、Web 検索の `encrypted_content`、引用の `encrypted_index` は
//! 1 文字でも変わると次の要求が 400 になるため、型に写して作り直さない。

use serde_json::{Map, Value};

/// SSE の 1 件（`event:` と `data:` の組）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// バイト列を受け取り、区切りの空行ごとに `SseEvent` を返す。
///
/// 受け取ったチャンクを毎回文字列にすると、日本語の 1 文字（UTF-8 で 3 バイト）がチャンクの境で
/// 割れたときに壊れるので、バイト列のまま溜めてから区切る。
#[derive(Debug, Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some((end, sep_len)) = find_blank_line(&self.buf) {
            let raw: Vec<u8> = self.buf.drain(..end + sep_len).take(end).collect();
            if let Some(event) = parse_event(&String::from_utf8_lossy(&raw)) {
                events.push(event);
            }
        }
        events
    }
}

/// 空行（`\n\n` か `\r\n\r\n`）の位置と長さ。
fn find_blank_line(buf: &[u8]) -> Option<(usize, usize)> {
    let lf = buf.windows(2).position(|w| w == b"\n\n").map(|i| (i, 2));
    let crlf = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| (i, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, b) => a.or(b),
    }
}

fn parse_event(raw: &str) -> Option<SseEvent> {
    let mut event = None;
    let mut data: Vec<&str> = Vec::new();
    for line in raw.lines() {
        // `:` で始まる行はコメント（接続を保つための空送り）
        if line.starts_with(':') {
            continue;
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => event = Some(value.to_owned()),
            "data" => data.push(value),
            _ => {}
        }
    }
    if event.is_none() && data.is_empty() {
        return None;
    }
    Some(SseEvent {
        event,
        data: data.join("\n"),
    })
}

/// 画面へ流す断片。`index` はその API 応答の中のブロックの位置。
#[derive(Debug, Clone, PartialEq)]
pub enum Delta {
    Text {
        index: usize,
        text: String,
    },
    Thinking {
        index: usize,
        text: String,
    },
    Citation {
        index: usize,
        citation: Value,
    },
    /// ブロックが始まった（ツールの呼び出しや Web 検索の結果を画面に出すため）
    BlockStart {
        index: usize,
        block: Value,
    },
    /// ブロックが閉じた。ツールの入力はここで確定する
    BlockStop {
        index: usize,
        block: Value,
    },
}

/// ストリームが API のエラーを返した（HTTP 200 の後の `event: error`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamError {
    pub error_type: String,
    pub message: String,
}

/// 組み立て終わった 1 回分の応答。
#[derive(Debug, Clone, PartialEq)]
pub struct FinalMessage {
    pub model: Option<String>,
    pub content: Vec<Value>,
    pub stop_reason: Option<String>,
    pub stop_details: Option<Value>,
    pub usage: Map<String, Value>,
}

impl FinalMessage {
    /// `tool_use` ブロックの入力の JSON が壊れていた（`max_tokens` で途中で切れたなど）か。
    #[must_use]
    pub fn has_invalid_tool_input(&self) -> bool {
        self.content
            .iter()
            .any(|b| b.get(INVALID_INPUT_MARK).is_some())
    }
}

/// 入力の JSON を読めなかったブロックに付ける印。送り返す前に必ず取り除く（API は知らないキーを 400 にする）。
pub const INVALID_INPUT_MARK: &str = "__invalid_input";

#[derive(Debug, Default)]
pub struct MessageAccumulator {
    model: Option<String>,
    blocks: Vec<Option<Value>>,
    partial_json: Vec<Option<String>>,
    stop_reason: Option<String>,
    stop_details: Option<Value>,
    usage: Map<String, Value>,
    stopped: bool,
}

impl MessageAccumulator {
    /// SSE の 1 件を取り込み、画面へ流す断片を返す。
    ///
    /// # Errors
    ///
    /// ストリームが `error` を返したとき。
    pub fn handle(&mut self, event: &SseEvent) -> Result<Vec<Delta>, StreamError> {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else {
            // ping などの JSON でない data は無視する。知らないイベントで止めないため
            return Ok(Vec::new());
        };
        let kind = data.get("type").and_then(Value::as_str).unwrap_or_default();
        match kind {
            "message_start" => {
                if let Some(message) = data.get("message") {
                    self.model = message
                        .get("model")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    merge_usage(&mut self.usage, message.get("usage"));
                }
                Ok(Vec::new())
            }
            "content_block_start" => Ok(self.block_start(&data)),
            "content_block_delta" => Ok(self.block_delta(&data)),
            "content_block_stop" => Ok(self.block_stop(&data)),
            "message_delta" => {
                if let Some(delta) = data.get("delta") {
                    if let Some(reason) = delta.get("stop_reason").and_then(Value::as_str) {
                        self.stop_reason = Some(reason.to_owned());
                    }
                    if let Some(details) = delta.get("stop_details").filter(|d| !d.is_null()) {
                        self.stop_details = Some(details.clone());
                    }
                }
                merge_usage(&mut self.usage, data.get("usage"));
                Ok(Vec::new())
            }
            "message_stop" => {
                self.stopped = true;
                Ok(Vec::new())
            }
            "error" => {
                let error = data.get("error");
                let field = |name: &str| {
                    error
                        .and_then(|e| e.get(name))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned()
                };
                Err(StreamError {
                    error_type: field("type"),
                    message: field("message"),
                })
            }
            _ => Ok(Vec::new()),
        }
    }

    fn block_start(&mut self, data: &Value) -> Vec<Delta> {
        let (Some(index), Some(block)) = (index_of(data), data.get("content_block")) else {
            return Vec::new();
        };
        if self.blocks.len() <= index {
            self.blocks.resize(index + 1, None);
            self.partial_json.resize(index + 1, None);
        }
        self.blocks[index] = Some(block.clone());
        vec![Delta::BlockStart {
            index,
            block: block.clone(),
        }]
    }

    fn block_delta(&mut self, data: &Value) -> Vec<Delta> {
        let (Some(index), Some(delta)) = (index_of(data), data.get("delta")) else {
            return Vec::new();
        };
        let Some(Some(block)) = self.blocks.get_mut(index) else {
            return Vec::new();
        };
        let kind = delta
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match kind {
            "text_delta" => {
                let text = str_field(delta, "text");
                append_str(block, "text", &text);
                vec![Delta::Text { index, text }]
            }
            "thinking_delta" => {
                let text = str_field(delta, "thinking");
                append_str(block, "thinking", &text);
                vec![Delta::Thinking { index, text }]
            }
            "signature_delta" => {
                append_str(block, "signature", &str_field(delta, "signature"));
                Vec::new()
            }
            "input_json_delta" => {
                if let Some(slot) = self.partial_json.get_mut(index) {
                    slot.get_or_insert_with(String::new)
                        .push_str(&str_field(delta, "partial_json"));
                }
                Vec::new()
            }
            "citations_delta" => {
                let Some(citation) = delta.get("citation") else {
                    return Vec::new();
                };
                if let Some(obj) = block.as_object_mut() {
                    let list = obj
                        .entry("citations")
                        .or_insert_with(|| Value::Array(Vec::new()));
                    if !list.is_array() {
                        *list = Value::Array(Vec::new());
                    }
                    if let Some(list) = list.as_array_mut() {
                        list.push(citation.clone());
                    }
                }
                vec![Delta::Citation {
                    index,
                    citation: citation.clone(),
                }]
            }
            _ => Vec::new(),
        }
    }

    fn block_stop(&mut self, data: &Value) -> Vec<Delta> {
        let Some(index) = index_of(data) else {
            return Vec::new();
        };
        let json = self.partial_json.get_mut(index).and_then(Option::take);
        let Some(Some(block)) = self.blocks.get_mut(index) else {
            return Vec::new();
        };
        if let (Some(json), Some(obj)) = (json, block.as_object_mut()) {
            // 入力のないツール呼び出しは partial_json が空文字で届く
            let parsed = if json.trim().is_empty() {
                Ok(Value::Object(Map::new()))
            } else {
                serde_json::from_str::<Value>(&json)
            };
            match parsed {
                Ok(input) => {
                    obj.insert("input".to_owned(), input);
                }
                Err(_) => {
                    obj.insert(INVALID_INPUT_MARK.to_owned(), Value::Bool(true));
                }
            }
        }
        vec![Delta::BlockStop {
            index,
            block: block.clone(),
        }]
    }

    /// 組み立てを終える。
    ///
    /// # Errors
    ///
    /// `message_stop` が届く前にストリームが終わったとき（通信の途中切断）。
    pub fn finish(self) -> Result<FinalMessage, StreamError> {
        if !self.stopped {
            return Err(StreamError {
                error_type: "incomplete_stream".to_owned(),
                message: "応答の途中で通信が切れました".to_owned(),
            });
        }
        Ok(FinalMessage {
            model: self.model,
            content: self.blocks.into_iter().flatten().collect(),
            stop_reason: self.stop_reason,
            stop_details: self.stop_details,
            usage: self.usage,
        })
    }
}

fn index_of(data: &Value) -> Option<usize> {
    data.get("index")
        .and_then(Value::as_u64)
        .and_then(|i| usize::try_from(i).ok())
}

fn str_field(value: &Value, name: &str) -> String {
    value
        .get(name)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn append_str(block: &mut Value, field: &str, text: &str) {
    if let Some(obj) = block.as_object_mut() {
        let current = obj
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        obj.insert(field.to_owned(), Value::String(current + text));
    }
}

/// `message_start` と `message_delta` の usage を合わせる。後から届いた値で上書きする（累計で届くため）。
fn merge_usage(usage: &mut Map<String, Value>, incoming: Option<&Value>) {
    if let Some(Value::Object(incoming)) = incoming {
        for (key, value) in incoming {
            if !value.is_null() {
                usage.insert(key.clone(), value.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sse(event: &str, data: &Value) -> String {
        format!("event: {event}\ndata: {data}\n\n")
    }

    fn run(chunks: &[&[u8]]) -> (Vec<Delta>, Result<FinalMessage, StreamError>) {
        let mut parser = SseParser::default();
        let mut acc = MessageAccumulator::default();
        let mut deltas = Vec::new();
        for chunk in chunks {
            for event in parser.push(chunk) {
                match acc.handle(&event) {
                    Ok(d) => deltas.extend(d),
                    Err(e) => return (deltas, Err(e)),
                }
            }
        }
        (deltas, acc.finish())
    }

    fn text_stream(text: &str) -> String {
        [
            sse(
                "message_start",
                &json!({"type":"message_start","message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":10,"output_tokens":1}}}),
            ),
            sse(
                "content_block_start",
                &json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
            ),
            sse("ping", &json!({"type":"ping"})),
            sse(
                "content_block_stop",
                &json!({"type":"content_block_stop","index":0}),
            ),
            sse(
                "message_delta",
                &json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}),
            ),
            sse("message_stop", &json!({"type":"message_stop"})),
        ]
        .concat()
    }

    #[test]
    fn assembles_text_and_usage() {
        let stream = text_stream("止血帯を巻く");
        let (deltas, result) = run(&[stream.as_bytes()]);
        let message = result.expect("ストリームが完結している");
        assert_eq!(
            message.content,
            vec![json!({"type":"text","text":"止血帯を巻く"})]
        );
        assert_eq!(message.stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(message.usage.get("input_tokens"), Some(&json!(10)));
        assert_eq!(message.usage.get("output_tokens"), Some(&json!(7)));
        assert!(deltas.contains(&Delta::Text {
            index: 0,
            text: "止血帯を巻く".to_owned()
        }));
    }

    #[test]
    fn japanese_split_across_chunks_is_not_broken() {
        let stream = text_stream("止血帯");
        let bytes = stream.as_bytes();
        // 「止」の 3 バイトの途中で切る
        let pos = stream.find('止').expect("本文がある") + 1;
        let (_, result) = run(&[&bytes[..pos], &bytes[pos..]]);
        let message = result.expect("ストリームが完結している");
        assert_eq!(message.content[0]["text"], "止血帯");
    }

    #[test]
    fn crlf_separators_are_accepted() {
        let stream = text_stream("a").replace('\n', "\r\n");
        let (_, result) = run(&[stream.as_bytes()]);
        assert_eq!(result.expect("完結").content[0]["text"], "a");
    }

    #[test]
    fn stream_cut_before_message_stop_is_an_error() {
        let stream = text_stream("a");
        let cut = stream.find("event: message_delta").expect("区切りがある");
        let (_, result) = run(&[&stream.as_bytes()[..cut]]);
        assert_eq!(
            result.expect_err("途中で切れている").error_type,
            "incomplete_stream"
        );
    }

    #[test]
    fn error_event_is_reported() {
        let stream = sse(
            "error",
            &json!({"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}),
        );
        let (_, result) = run(&[stream.as_bytes()]);
        assert_eq!(
            result.expect_err("error イベント"),
            StreamError {
                error_type: "overloaded_error".to_owned(),
                message: "Overloaded".to_owned()
            }
        );
    }

    #[test]
    fn thinking_signature_and_tool_input_are_kept() {
        let stream = [
            sse("message_start", &json!({"type":"message_start","message":{"usage":{}}})),
            sse(
                "content_block_start",
                &json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"考える"}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"SIG"}}),
            ),
            sse("content_block_stop", &json!({"type":"content_block_stop","index":0})),
            sse(
                "content_block_start",
                &json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"search_manual","input":{}}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"止"}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"血\",\"include_other_mods\":false}"}}),
            ),
            sse("content_block_stop", &json!({"type":"content_block_stop","index":1})),
            sse(
                "content_block_start",
                &json!({"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"t2","name":"ask_user","input":{}}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"question\":\"呼吸は"}}),
            ),
            sse("content_block_stop", &json!({"type":"content_block_stop","index":2})),
            sse(
                "message_delta",
                &json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}),
            ),
            sse("message_stop", &json!({"type":"message_stop"})),
        ]
        .concat();
        let (_, result) = run(&[stream.as_bytes()]);
        let message = result.expect("完結");
        assert_eq!(
            message.content[0],
            json!({"type":"thinking","thinking":"考える","signature":"SIG"})
        );
        assert_eq!(
            message.content[1]["input"],
            json!({"query":"止血","include_other_mods":false})
        );
        // 2 つ目のツールの入力は閉じていない JSON なので、壊れた印を付ける
        assert!(message.has_invalid_tool_input());
        assert_eq!(message.content[2][INVALID_INPUT_MARK], json!(true));
    }

    #[test]
    fn citations_are_appended_to_the_text_block() {
        let citation = json!({"type":"search_result_location","source":"doc:hemorrhage.md#止血帯を使う","title":"止血","cited_text":"巻く","search_result_index":0,"start_block_index":0,"end_block_index":1});
        let stream = [
            sse("message_start", &json!({"type":"message_start","message":{"usage":{}}})),
            sse(
                "content_block_start",
                &json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"","citations":[]}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":citation}}),
            ),
            sse(
                "content_block_delta",
                &json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"巻く"}}),
            ),
            sse("content_block_stop", &json!({"type":"content_block_stop","index":0})),
            sse(
                "message_delta",
                &json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}),
            ),
            sse("message_stop", &json!({"type":"message_stop"})),
        ]
        .concat();
        let (deltas, result) = run(&[stream.as_bytes()]);
        let message = result.expect("完結");
        assert_eq!(message.content[0]["citations"], json!([citation]));
        assert!(deltas.iter().any(|d| matches!(d, Delta::Citation { .. })));
    }

    #[test]
    fn refusal_details_are_kept() {
        let stream = [
            sse("message_start", &json!({"type":"message_start","message":{"usage":{}}})),
            sse(
                "message_delta",
                &json!({"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"type":"refusal","category":"bio","explanation":"x"}}}),
            ),
            sse("message_stop", &json!({"type":"message_stop"})),
        ]
        .concat();
        let (_, result) = run(&[stream.as_bytes()]);
        let message = result.expect("完結");
        assert_eq!(message.stop_reason.as_deref(), Some("refusal"));
        assert_eq!(
            message
                .stop_details
                .as_ref()
                .and_then(|d| d.get("category")),
            Some(&json!("bio"))
        );
    }
}
