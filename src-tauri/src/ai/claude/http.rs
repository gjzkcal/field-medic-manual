//! Claude API との通信。テストでは本物の API を呼ばないよう、送信を `Transport` で差し替える。
//! 送り先はこのファイルの定数だけにする（設定や環境変数で変えられると、キーを別のホストへ送れてしまうため）。

use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderValue, RETRY_AFTER};
use serde_json::Value;

use super::{API_VERSION, BETAS};
use crate::ai::claude;
use crate::ai::types::{AiModel, ChatUsage};
use crate::error::AppError;

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const COUNT_TOKENS_URL: &str = "https://api.anthropic.com/v1/messages/count_tokens";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 応答の全体には時間の上限を付けない（考える量が多いと数分かかる）。代わりに、届くまでの待ちに上限を付ける
const FIRST_BYTE_TIMEOUT: Duration = Duration::from_mins(2);
/// retry-after がとても長いときに、画面を止めたまま待ち続けないための上限
const MAX_RETRY_AFTER: Duration = Duration::from_secs(20);

pub type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, AppError>> + Send>>;

/// 送信の失敗。再試行するかと待ち時間を、呼ぶ側で決められるように持つ。
#[derive(Debug)]
pub struct SendFailure {
    pub error: AppError,
    pub retryable: bool,
    pub retry_after: Option<Duration>,
    /// 組織の設定で Web 検索が切られている（400）
    pub web_search_disabled: bool,
}

pub trait Transport: Send + Sync {
    fn send(&self, body: Value) -> impl Future<Output = Result<ByteStream, SendFailure>> + Send;
}

pub struct HttpTransport {
    key: String,
}

impl HttpTransport {
    #[must_use]
    pub const fn new(key: String) -> Self {
        Self { key }
    }
}

impl Transport for HttpTransport {
    async fn send(&self, body: Value) -> Result<ByteStream, SendFailure> {
        let response = client()
            .map_err(|error| SendFailure {
                error,
                retryable: false,
                retry_after: None,
                web_search_disabled: false,
            })?
            .post(MESSAGES_URL)
            .headers(headers(&self.key).map_err(|error| SendFailure {
                error,
                retryable: false,
                retry_after: None,
                web_search_disabled: false,
            })?)
            .json(&body)
            .timeout(FIRST_BYTE_TIMEOUT)
            .send()
            .await
            .map_err(|e| network_failure(&e))?;
        if !response.status().is_success() {
            return Err(status_failure(response).await);
        }
        // ここで付けた timeout は応答の頭までなので、本文の読み出しには呼ぶ側の待ちの上限が効く
        Ok(Box::pin(response.bytes_stream().map(|chunk| {
            chunk.map_err(|e| AppError::Network(format!("応答の途中で通信が切れました（{e}）")))
        })))
    }
}

/// キーとモデルが使えるかを確かめる（設定画面の「接続を確認」）。
///
/// # Errors
///
/// キーが無効なら `AiAuth`、モデルがなければ `AiRequest`、通信できなければ `Network`。
pub async fn check(key: &str, model: AiModel) -> Result<(), AppError> {
    let response = client()?
        .get(format!("{MODELS_URL}/{}", model.id()))
        .headers(headers(key)?)
        .timeout(CONNECT_TIMEOUT)
        .send()
        .await
        .map_err(|e| network_failure(&e).error)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(status_failure(response).await.error)
    }
}

/// ストリーミングなしで要求を送り、使用量だけを返す（キャッシュの期限を延ばす `max_tokens: 0` の要求に使う）。
///
/// # Errors
///
/// キーが無効なら `AiAuth`、要求が受け付けられなければ `AiRequest`、通信できなければ `Network`。
pub async fn send_for_usage(key: &str, body: &Value) -> Result<ChatUsage, AppError> {
    let response = client()?
        .post(MESSAGES_URL)
        .headers(headers(key)?)
        .json(body)
        .timeout(FIRST_BYTE_TIMEOUT)
        .send()
        .await
        .map_err(|e| network_failure(&e).error)?;
    if !response.status().is_success() {
        return Err(status_failure(response).await.error);
    }
    let value: Value = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("応答を読めませんでした（{e}）")))?;
    Ok(value
        .get("usage")
        .and_then(Value::as_object)
        .map(claude::usage)
        .unwrap_or_default())
}

/// 要求の入力トークン数を数える（モデルは動かさない）。索引の大きさの計測と評価に使う。
///
/// # Errors
///
/// キーが無効なら `AiAuth`、要求の形が受け付けられなければ `AiRequest`、通信できなければ `Network`。
pub async fn count_tokens(key: &str, body: &Value) -> Result<u64, AppError> {
    let response = client()?
        .post(COUNT_TOKENS_URL)
        .headers(headers(key)?)
        .json(body)
        .timeout(FIRST_BYTE_TIMEOUT)
        .send()
        .await
        .map_err(|e| network_failure(&e).error)?;
    if !response.status().is_success() {
        return Err(status_failure(response).await.error);
    }
    let value: Value = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("応答を読めませんでした（{e}）")))?;
    value
        .get("input_tokens")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::AiRequest("応答に input_tokens がありません".to_owned()))
}

fn client() -> Result<&'static reqwest::Client, AppError> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            // reqwest は暗号の実装を持たない設定（rustls-no-provider）で入れているので、updater と同じ ring を既定にする
            if rustls::crypto::CryptoProvider::get_default().is_none() {
                let _ = rustls::crypto::ring::default_provider().install_default();
            }
            reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .https_only(true)
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| AppError::Internal(format!("通信の準備に失敗しました: {e}")))
}

fn headers(key: &str) -> Result<HeaderMap, AppError> {
    let mut map = HeaderMap::new();
    let mut value = HeaderValue::from_str(key)
        .map_err(|_| AppError::AiAuth("API キーに使えない文字が含まれています".to_owned()))?;
    // ログやデバッグ表示にキーが出ないようにする
    value.set_sensitive(true);
    map.insert("x-api-key", value);
    map.insert("anthropic-version", HeaderValue::from_static(API_VERSION));
    map.insert("anthropic-beta", HeaderValue::from_static(BETAS));
    map.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(map)
}

fn network_failure(e: &reqwest::Error) -> SendFailure {
    let message = if e.is_timeout() {
        "AI のサーバーから応答がありません".to_owned()
    } else if e.is_connect() {
        "AI のサーバーに接続できません。インターネットの接続を確かめてください".to_owned()
    } else {
        format!("通信に失敗しました（{e}）")
    };
    SendFailure {
        error: AppError::Network(message),
        // 接続の前で失敗したなら、送り直しても二重に課金されない
        retryable: e.is_connect() || e.is_timeout(),
        retry_after: None,
        web_search_disabled: false,
    }
}

async fn status_failure(response: reqwest::Response) -> SendFailure {
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|secs| Duration::from_secs(secs).min(MAX_RETRY_AFTER));
    let body = response.text().await.unwrap_or_default();
    classify(status, &body, retry_after)
}

/// HTTP の状態と本文（`{"error": {"type", "message"}}`）から、失敗の種類を決める。
fn classify(status: u16, body: &str, retry_after: Option<Duration>) -> SendFailure {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.get("message")?.as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("HTTP {status}"));
    let lower = message.to_lowercase();
    let web_search_disabled =
        status == 400 && lower.contains("web search") && lower.contains("not enabled");
    let (error, retryable) = match status {
        401 | 403 => (AppError::AiAuth(message), false),
        404 => (
            AppError::AiRequest(format!(
                "モデルが見つかりません。設定でモデルを変えてください（{message}）"
            )),
            false,
        ),
        429 => (AppError::RateLimited(message), true),
        500..=599 => (AppError::Overloaded(message), true),
        _ => (AppError::AiRequest(message), false),
    };
    SendFailure {
        error,
        retryable,
        retry_after,
        web_search_disabled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_map_to_error_kinds() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let auth = classify(401, body, None);
        assert!(matches!(auth.error, AppError::AiAuth(ref m) if m == "invalid x-api-key"));
        assert!(!auth.retryable);
        assert!(classify(429, "{}", Some(Duration::from_secs(3))).retryable);
        let overloaded = classify(529, "not json", None);
        assert!(matches!(overloaded.error, AppError::Overloaded(ref m) if m == "HTTP 529"));
        assert!(overloaded.retryable);
        assert!(matches!(
            classify(404, "{}", None).error,
            AppError::AiRequest(_)
        ));
        assert!(matches!(
            classify(400, "{}", None).error,
            AppError::AiRequest(_)
        ));
    }

    #[test]
    fn web_search_disabled_is_detected() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"Web search is not enabled for this organization"}}"#;
        assert!(classify(400, body, None).web_search_disabled);
        assert!(
            !classify(
                400,
                r#"{"error":{"message":"credit balance is too low"}}"#,
                None
            )
            .web_search_disabled
        );
    }

    #[test]
    fn key_header_is_sensitive() {
        let map = headers("sk-ant-test").expect("ヘッダにできる");
        assert!(map.get("x-api-key").is_some_and(HeaderValue::is_sensitive));
        assert_eq!(
            map.get("anthropic-version").and_then(|v| v.to_str().ok()),
            Some(API_VERSION)
        );
        assert_eq!(
            map.get("anthropic-beta").and_then(|v| v.to_str().ok()),
            Some(BETAS)
        );
    }
}
