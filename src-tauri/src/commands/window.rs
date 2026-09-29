use tauri::AppHandle;

use crate::error::AppError;
use crate::model::{HotkeyAction, HotkeyBinding};
use crate::window::{hotkey, overlay};

/// # Errors
///
/// 状態が壊れている場合は `Internal`。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&AppHandle は CommandArg を実装していない）"
)]
pub fn hotkey_list(app: AppHandle) -> Result<Vec<HotkeyBinding>, AppError> {
    hotkey::list(&app)
}

/// # Errors
///
/// 組み合わせが不正、ほかの動作と重なる、登録に失敗した場合は `InvalidInput`。
#[tauri::command]
pub async fn hotkey_set(
    app: AppHandle,
    action: HotkeyAction,
    accelerator: String,
) -> Result<(), AppError> {
    hotkey::set(&app, action, &accelerator).await
}

/// 小窓で開いている画面を、メインウィンドウで開く。
///
/// # Errors
///
/// URL がアプリ内の絶対パスでない場合は `InvalidInput`。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&AppHandle は CommandArg を実装していない）"
)]
pub fn window_open_in_main(app: AppHandle, href: String) -> Result<(), AppError> {
    // イベントでメインのルーターに渡すだけなので、アプリ内のパス以外（外部の URL など）は受け付けない
    if !href.starts_with('/') || href.starts_with("//") {
        return Err(AppError::InvalidInput(format!(
            "アプリ内のパスではありません: {href}"
        )));
    }
    overlay::show_main(&app, Some(&href)).map_err(|e| window_error(&e))
}

/// 閲覧モードの小窓で入力欄を押したときに、小窓へフォーカスを移す。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合は `Internal`。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&AppHandle は CommandArg を実装していない）"
)]
pub fn overlay_activate(app: AppHandle) -> Result<(), AppError> {
    overlay::activate(&app).map_err(|e| window_error(&e))
}

/// メインの最初の画面を描き終えたことを知らせ、非表示で起動したメインを出す。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合は `Internal`。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&AppHandle は CommandArg を実装していない）"
)]
pub fn main_window_ready(app: AppHandle) -> Result<(), AppError> {
    overlay::reveal_main(&app).map_err(|e| window_error(&e))
}

fn window_error(error: &tauri::Error) -> AppError {
    AppError::Internal(format!("ウィンドウを操作できませんでした: {error}"))
}
