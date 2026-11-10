//! Claude の Messages API に固有の部分。要求の組み立て・ツールの定義・結果と引用の変換。
//! ほかの AI を足すときは、このモジュールと同じ役割のものを `ai/<名前>/` に作る。

pub mod http;
pub mod sse;

use serde_json::{Map, Value, json};

use crate::ai::tools::{ASK_USER, READ_SECTION, SEARCH_MANUAL, SourceDoc, ToolOutput};
use crate::ai::types::{AiEffort, AiModel, ChatCitation, ChatImage, ChatUsage};

/// 2026-10-21 版で temperature などが無くなり、引用付きの文を user に入れられなくなった。
/// このアプリはどちらも使わないので、新しい版に合わせておく（後で移す手間をなくすため）
pub const API_VERSION: &str = "2026-10-21";
/// xhigh / max の effort では 64000 以上が要る（足りないと考えている途中で切れる）。ストリーミングなので大きくても時間切れにならない
const MAX_TOKENS: u32 = 64000;
pub const WEB_SEARCH: &str = "web_search";
/// 語の意味を調べる先。ACE の公式の文書・リポジトリと、本体の Wiki だけにする
const WEB_SEARCH_DOMAINS: [&str; 3] = [
    "anvil.acemod.org",
    "github.com/acemod/ACE-Anvil",
    "community.bistudio.com",
];
const WEB_SEARCH_MAX_USES: u32 = 2;

/// ツールの定義。会話の間は同じものを送る（変えると thinking の署名が無効になる）。
#[must_use]
pub fn tools(web_search: bool) -> Value {
    let mut list = vec![
        json!({
            "name": SEARCH_MANUAL,
            "description": "同梱の原稿とクイック表を全文検索する。文字が一致した節の本文を返す。原稿の語で探すと当たりやすい。",
            "strict": true,
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "探す語。空白で区切ると、すべてを含む節を探す"},
                    "include_other_mods": {"type": "boolean", "description": "利用者の MOD に合わない節も含めるか。ふだんは false"}
                },
                "required": ["query", "include_other_mods"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": READ_SECTION,
            "description": "索引の source（doc:<ファイル名>#<アンカー> か quickref:<id>）を指定して、その節と配下の節の本文を読む。",
            "strict": true,
            "input_schema": {
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "索引に書いてある source をそのまま"}
                },
                "required": ["source"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": ASK_USER,
            "description": "答えによって当てはまる節や処置が変わるのに質問から分からないとき、利用者に選択肢で聞き返す。1 つの質問につき 2 回まで。",
            "strict": true,
            "input_schema": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "聞くこと（短く）"},
                    "options": {"type": "array", "items": {"type": "string"}, "description": "選択肢。2〜4 個"},
                    "multi_select": {"type": "boolean", "description": "複数を選べるか"}
                },
                "required": ["question", "options", "multi_select"],
                "additionalProperties": false
            }
        }),
    ];
    if web_search {
        list.push(json!({
            "type": "web_search_20260209",
            "name": WEB_SEARCH,
            "max_uses": WEB_SEARCH_MAX_USES,
            "allowed_domains": WEB_SEARCH_DOMAINS,
            // dynamic filtering（コードの実行）を使わない。結果の形が単純になり、ZDR の対象からも外れない
            "allowed_callers": ["direct"]
        }));
    }
    Value::Array(list)
}

/// 1 回分の要求の本文。
#[must_use]
pub fn request_body(
    model: AiModel,
    effort: AiEffort,
    system: &str,
    tools: &Value,
    messages: &[Value],
    force_answer: bool,
) -> Value {
    let mut body = json!({
        "model": model.id(),
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "system": [{"type": "text", "text": system}],
        "tools": tools,
        "messages": messages,
        // 要約を画面の「考えている途中」に出す。表示を変えても料金は同じ
        "thinking": {"type": "adaptive", "display": "summarized"},
        "output_config": {"effort": effort.as_str()},
        // 最後のブロックまでを自動でキャッシュする。索引（system）が大きいので、2 問目からの入力が安くなる
        "cache_control": {"type": "ephemeral"}
    });
    if force_answer && let Some(obj) = body.as_object_mut() {
        obj.insert("tool_choice".to_owned(), json!({"type": "none"}));
    }
    body
}

/// 利用者の質問。画像は本文より前に置く（API の推奨）。
#[must_use]
pub fn user_message(text: &str, images: &[ChatImage]) -> Value {
    let mut content: Vec<Value> = images
        .iter()
        .map(|image| {
            json!({
                "type": "image",
                "source": {"type": "base64", "media_type": image.media_type.as_str(), "data": image.data}
            })
        })
        .collect();
    content.push(json!({"type": "text", "text": text}));
    json!({"role": "user", "content": content})
}

#[must_use]
pub fn assistant_message(content: Vec<Value>) -> Value {
    json!({"role": "assistant", "content": Value::Array(content)})
}

/// ツールの結果をまとめた user のメッセージ。並列の呼び出しの結果は 1 つのメッセージに入れる（分けると並列で呼ばなくなる）。
#[must_use]
pub fn tool_results_message(results: Vec<Value>, force_answer_note: bool) -> Value {
    let mut content = results;
    if force_answer_note {
        content.push(json!({
            "type": "text",
            "text": "ツールを使える回数の上限に達しました。ここまでに読んだ節だけで答えてください。足りなければ、マニュアルに載っていないと答えてください。"
        }));
    }
    json!({"role": "user", "content": content})
}

#[must_use]
pub fn tool_result(tool_use_id: &str, output: &ToolOutput) -> Value {
    match output {
        ToolOutput::Sources(docs) => json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": docs.iter().map(search_result).collect::<Vec<_>>()
        }),
        ToolOutput::Text(text) => json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": [{"type": "text", "text": text}]
        }),
        ToolOutput::Error(text) => json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "is_error": true,
            "content": [{"type": "text", "text": text}]
        }),
    }
}

/// 原稿の節を `search_result` にする。回答の文に、この source と title の引用が付く。
fn search_result(doc: &SourceDoc) -> Value {
    json!({
        "type": "search_result",
        "source": doc.source,
        "title": doc.title,
        "content": doc.paragraphs.iter().map(|p| json!({"type": "text", "text": p})).collect::<Vec<_>>(),
        // 1 つの要求の中の search_result は、すべて同じ設定にしないといけない
        "citations": {"enabled": true}
    })
}

/// 引用を画面の形にする。知らない種類は出さない。
#[must_use]
pub fn citation(value: &Value) -> Option<ChatCitation> {
    let field = |name: &str| value.get(name).and_then(Value::as_str).map(str::to_owned);
    match value.get("type").and_then(Value::as_str)? {
        "search_result_location" => Some(ChatCitation::Manual {
            source: field("source")?,
            title: field("title").unwrap_or_default(),
            cited_text: field("cited_text").unwrap_or_default(),
        }),
        "web_search_result_location" => Some(ChatCitation::Web {
            url: field("url")?,
            title: field("title").unwrap_or_default(),
            cited_text: field("cited_text").unwrap_or_default(),
        }),
        _ => None,
    }
}

#[must_use]
pub fn usage(map: &Map<String, Value>) -> ChatUsage {
    let num = |name: &str| map.get(name).and_then(Value::as_u64).unwrap_or(0);
    ChatUsage {
        input_tokens: num("input_tokens"),
        output_tokens: num("output_tokens"),
        cache_read_tokens: num("cache_read_input_tokens"),
        cache_write_tokens: num("cache_creation_input_tokens"),
        web_searches: map
            .get("server_tool_use")
            .and_then(|s| s.get("web_search_requests"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ImageMediaType;

    #[test]
    fn web_search_is_restricted_and_optional() {
        let with = tools(true);
        let web = with
            .as_array()
            .and_then(|l| l.iter().find(|t| t["name"] == WEB_SEARCH))
            .expect("Web 検索がある");
        assert_eq!(web["allowed_domains"].as_array().map(Vec::len), Some(3));
        assert_eq!(web["allowed_callers"], json!(["direct"]));
        assert_eq!(web["max_uses"], json!(2));
        let without = tools(false);
        assert!(
            without
                .as_array()
                .is_some_and(|l| l.iter().all(|t| t["name"] != WEB_SEARCH))
        );
    }

    #[test]
    fn request_body_sets_effort_and_forced_answer() {
        let body = request_body(
            AiModel::ClaudeSonnet55,
            AiEffort::Xhigh,
            "sys",
            &tools(true),
            &[],
            false,
        );
        assert_eq!(body["model"], "claude-sonnet-5-5");
        assert_eq!(body["output_config"]["effort"], "xhigh");
        assert_eq!(body["max_tokens"], json!(MAX_TOKENS));
        assert!(body.get("tool_choice").is_none());
        // サンプリングの値は 2026-10-21 版では送れない
        assert!(body.get("temperature").is_none());
        let forced = request_body(
            AiModel::ClaudeHaiku55,
            AiEffort::Low,
            "sys",
            &tools(false),
            &[],
            true,
        );
        assert_eq!(forced["tool_choice"], json!({"type": "none"}));
    }

    #[test]
    fn user_message_puts_images_before_text() {
        let message = user_message(
            "これは？",
            &[ChatImage {
                media_type: ImageMediaType::Png,
                data: "AAAA".to_owned(),
            }],
        );
        assert_eq!(message["content"][0]["type"], "image");
        assert_eq!(message["content"][0]["source"]["media_type"], "image/png");
        assert_eq!(
            message["content"][1],
            json!({"type": "text", "text": "これは？"})
        );
    }

    #[test]
    fn tool_results_become_search_results() {
        let output = ToolOutput::Sources(vec![SourceDoc {
            source: "doc:a.md#b".to_owned(),
            title: "A > B".to_owned(),
            paragraphs: vec!["一".to_owned(), "二".to_owned()],
        }]);
        let block = tool_result("t1", &output);
        assert_eq!(block["content"][0]["type"], "search_result");
        assert_eq!(block["content"][0]["content"][1]["text"], "二");
        assert_eq!(block["content"][0]["citations"], json!({"enabled": true}));
        let error = tool_result("t2", &ToolOutput::Error("ない".to_owned()));
        assert_eq!(error["is_error"], json!(true));
    }

    #[test]
    fn citations_are_mapped() {
        let manual = json!({"type": "search_result_location", "source": "doc:a.md#b", "title": "A", "cited_text": "x"});
        assert_eq!(
            citation(&manual),
            Some(ChatCitation::Manual {
                source: "doc:a.md#b".to_owned(),
                title: "A".to_owned(),
                cited_text: "x".to_owned()
            })
        );
        let web = json!({"type": "web_search_result_location", "url": "https://anvil.acemod.org/x", "title": "T", "cited_text": "y", "encrypted_index": "E"});
        assert!(matches!(citation(&web), Some(ChatCitation::Web { .. })));
        assert_eq!(citation(&json!({"type": "char_location"})), None);
    }

    #[test]
    fn usage_reads_cache_and_web_search_counts() {
        let map = json!({"input_tokens": 5, "output_tokens": 6, "cache_read_input_tokens": 7, "cache_creation_input_tokens": 8, "server_tool_use": {"web_search_requests": 1}});
        let Value::Object(map) = map else {
            panic!("オブジェクト")
        };
        assert_eq!(
            usage(&map),
            ChatUsage {
                input_tokens: 5,
                output_tokens: 6,
                cache_read_tokens: 7,
                cache_write_tokens: 8,
                web_searches: 1
            }
        );
    }
}
