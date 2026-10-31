use std::sync::atomic::{AtomicU32, Ordering};

use tauri::Window;

use crate::logging;

/// 1 起動で画面から書ける件数の上限。描画のたびに例外が出ても、ログの全世代を埋めないようにする
const MAX_CLIENT_LOGS: u32 = 200;

static CLIENT_LOG_COUNT: AtomicU32 = AtomicU32::new(0);

/// 画面で起きた例外をログに書く。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は値で受け取る（&Window は CommandArg を実装していない）"
)]
pub fn client_log(window: Window, message: String) {
    if CLIENT_LOG_COUNT.load(Ordering::Relaxed) >= MAX_CLIENT_LOGS {
        return;
    }
    if CLIENT_LOG_COUNT.fetch_add(1, Ordering::Relaxed) + 1 == MAX_CLIENT_LOGS {
        logging::client_error(
            window.label(),
            "これ以降、この起動の画面の例外は記録しません",
        );
        return;
    }
    logging::client_error(window.label(), &message);
}
