pub mod commands;
pub mod error;

/// # Panics
///
/// Tauri の初期化に失敗した場合（WebView2 がないなど）。起動できない状態なので続行しない。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::app::app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
