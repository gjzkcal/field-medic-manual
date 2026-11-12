use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::ai::claude::http::{self, HttpTransport};
use crate::ai::types::{
    AiKeyStatus, AiModel, ChatEvent, ChatSendInput, ChatTurnResult, ChatUsage, ClientToolResult,
};
use crate::ai::{AiState, key, turn};
use crate::db::Db;
use crate::error::AppError;

/// 資格情報の名前。開発版は identifier が違うので、配布版のキーを読み書きしない
fn service(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

/// 資格情報マネージャーは同期の API なので、非同期のランタイムを止めないよう別のスレッドで呼ぶ
async fn blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("資格情報の処理が異常終了しました: {e}")))?
}

async fn load_key(app: &AppHandle) -> Result<String, AppError> {
    let service = service(app);
    blocking(move || key::load(&service)).await?.ok_or_else(|| {
        AppError::AiAuth("API キーが登録されていません。設定で登録してください".to_owned())
    })
}

/// # Errors
///
/// 資格情報の処理が異常終了した場合。
#[tauri::command]
pub async fn ai_key_status(app: AppHandle) -> Result<AiKeyStatus, AppError> {
    let service = service(&app);
    blocking(move || Ok(key::status(&service))).await
}

/// # Errors
///
/// キーの形が違えば `InvalidInput`、資格情報マネージャーを使えなければ `AiAuth`。
#[tauri::command]
pub async fn ai_key_set(app: AppHandle, key: String) -> Result<(), AppError> {
    let key = key::validate(&key)?;
    let service = service(&app);
    blocking(move || key::save(&service, &key)).await
}

/// # Errors
///
/// 資格情報マネージャーを使えなければ `AiAuth`。
#[tauri::command]
pub async fn ai_key_clear(app: AppHandle) -> Result<(), AppError> {
    let service = service(&app);
    blocking(move || key::clear(&service)).await
}

/// 登録したキーで、選んだモデルを使えるか確かめる。
///
/// # Errors
///
/// キーがない・無効なら `AiAuth`、モデルがなければ `AiRequest`、通信できなければ `Network`。
#[tauri::command]
pub async fn ai_key_check(app: AppHandle, model: AiModel) -> Result<(), AppError> {
    let key = load_key(&app).await?;
    http::check(&key, model).await
}

/// 質問を送り、答えが出るまで待つ。途中の様子は `on_event` に流す。
///
/// # Errors
///
/// キーがない・入力が不正・回答中・API の失敗のとき。
#[tauri::command]
pub async fn ai_chat_send(
    app: AppHandle,
    db: State<'_, Db>,
    ai: State<'_, Arc<AiState>>,
    input: ChatSendInput,
    on_event: Channel<ChatEvent>,
) -> Result<ChatTurnResult, AppError> {
    let transport = HttpTransport::new(load_key(&app).await?);
    let emit = move |event: ChatEvent| on_event.send(event).is_ok();
    turn::run(ai.inner(), &db, &transport, input, &emit).await
}

/// 会話のキャッシュの期限を延ばす。会話がない・回答中なら何もせず None。
///
/// 索引を含む接頭辞は 5 分で消え、次の質問で書き直すと読む場合の何倍も費用がかかる。
/// 画面が、会話を開いている間だけ定期的に呼ぶ。返すのは、この要求で使ったトークン数（画面で合計に足す）。
///
/// # Errors
///
/// キーがない・API の失敗のとき。
#[tauri::command]
pub async fn ai_chat_keep_alive(
    app: AppHandle,
    ai: State<'_, Arc<AiState>>,
) -> Result<Option<ChatUsage>, AppError> {
    let Some(body) = ai.keep_alive_body()? else {
        return Ok(None);
    };
    let key = load_key(&app).await?;
    Ok(Some(http::send_for_usage(&key, &body).await?))
}

/// AI からの聞き返しに答える。
///
/// # Errors
///
/// 答えを待っている質問がなければ `NotFound`。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&State は CommandArg を実装していない）"
)]
pub fn ai_chat_tool_result(
    ai: State<'_, Arc<AiState>>,
    tool_use_id: String,
    result: ClientToolResult,
) -> Result<(), AppError> {
    ai.resolve_pending(&tool_use_id, result)
}

/// 回答を止める。止めた質問は会話に残らない。
///
/// # Errors
///
/// 会話の状態が壊れているとき。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&State は CommandArg を実装していない）"
)]
pub fn ai_chat_cancel(ai: State<'_, Arc<AiState>>) -> Result<(), AppError> {
    ai.cancel()
}

/// 会話を消す。回答中なら止める。
///
/// # Errors
///
/// 会話の状態が壊れているとき。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&State は CommandArg を実装していない）"
)]
pub fn ai_chat_reset(ai: State<'_, Arc<AiState>>) -> Result<(), AppError> {
    ai.reset()
}
