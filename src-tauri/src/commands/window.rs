use tauri::AppHandle;

use crate::error::AppError;
use crate::model::{HotkeyAction, HotkeyBinding};
use crate::window::{hotkey, overlay};

/// `window_open_in_main` のパスの長さの上限。検索語をハイライトする長い URL でも足りる
const MAX_HREF_LEN: usize = 4096;

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
    if !is_app_path(&href) {
        return Err(AppError::InvalidInput(
            "アプリ内のパスではありません".to_owned(),
        ));
    }
    overlay::show_main(&app, Some(&href)).map_err(|e| window_error(&e))
}

/// `/` で始まるアプリ内のパスか。`//host` と `/\host` はブラウザが別のホストとして読むので通さない。
/// アプリの作る URL は `\` と制御文字を % エンコードするので、生のまま含むものは不正とみなす。
/// TS 側の `src/lib/app-path.ts` と同じ判定にする。
fn is_app_path(href: &str) -> bool {
    href.len() <= MAX_HREF_LEN
        && href.starts_with('/')
        && !href.starts_with("//")
        && !href.contains('\\')
        && !href.chars().any(char::is_control)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_paths_inside_the_app() {
        for href in ["/", "/settings", "/doc/a%5Cb?hl=%E5%87%BA#x"] {
            assert!(is_app_path(href), "{href}");
        }
        let long = format!("/{}", "a".repeat(MAX_HREF_LEN));
        for href in [
            "",
            "settings",
            "https://example.com",
            "//example.com",
            "/\\example.com",
            "/doc\n",
            &long,
        ] {
            assert!(!is_app_path(href), "{href}");
        }
    }
}
