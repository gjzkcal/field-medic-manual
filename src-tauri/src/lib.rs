pub mod commands;
pub mod db;
pub mod error;
pub mod model;

use tauri::Manager;

/// # Panics
///
/// Tauri の初期化に失敗した場合（WebView2 がない、DB を開けないなど）。起動できない状態なので続行しない。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(db::Db::open(&data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_version,
            commands::docs::doc_upsert,
            commands::docs::doc_list,
            commands::docs::doc_get,
            commands::docs::doc_delete,
            commands::docs::doc_outline,
            commands::assets::asset_put,
            commands::assets::asset_get,
            commands::search::search_query,
            commands::dict::tag_list,
            commands::dict::synonym_list,
            commands::dict::synonym_save,
            commands::dict::synonym_delete,
            commands::settings::settings_get,
            commands::settings::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
