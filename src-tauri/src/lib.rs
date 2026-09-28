pub mod commands;
pub mod db;
pub mod error;
pub mod model;
pub mod window;

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_window_state::StateFlags;

use crate::window::{hotkey, overlay, tray};

/// # Panics
///
/// Tauri の初期化に失敗した場合（WebView2 がない、DB を開けないなど）。起動できない状態なので続行しない。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 2 つ目の起動を最初に止めるため、ほかのプラグインより先に登録する
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = overlay::show_main(app, None);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // 表示状態まで戻すと、隠していた小窓やトレイに格納したメインが起動時に出てしまう
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // 押しっぱなしで何度も切り替わらないよう、押した瞬間だけ反応する
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let Some(action) = hotkey::action_of(app, shortcut) else {
                        return;
                    };
                    let _ = match hotkey::overlay_mode(action) {
                        model::OverlayMode::View => overlay::toggle(app),
                        mode => overlay::show(app, mode),
                    };
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(hotkey::HotkeyState::default())
        .setup(|app| {
            // updater のクレートはデスクトップだけの依存にしてある（Cargo.toml）
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let data_dir = app.path().app_data_dir()?;
            app.manage(db::Db::open(&data_dir)?);
            tray::create(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 登録の失敗は設定画面に出すので、ここでは起動を止めない
                let _ = hotkey::register_saved(&handle).await;
            });
            Ok(())
        })
        .on_window_event(window::on_window_event)
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
            commands::triage::triage_list,
            commands::triage::triage_get,
            commands::triage::triage_upsert,
            commands::triage::triage_delete,
            commands::quickref::quickref_list,
            commands::quickref::quickref_replace_all,
            commands::prefs::fav_toggle,
            commands::prefs::fav_list,
            commands::prefs::history_push,
            commands::prefs::history_list,
            commands::window::hotkey_list,
            commands::window::hotkey_set,
            commands::window::window_open_in_main,
            commands::window::overlay_activate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
