// アプリのコマンドも権限（allow-<コマンド名>）にし、capability で許可したウィンドウからだけ呼べるようにする。
// 常に最前面の小窓から、本文の書き換えや削除を呼べないようにするため（dev-docs/reference/architecture.md §6）。
// コマンドを足したら、ここと capabilities/*.json の両方に足す。
const COMMANDS: &[&str] = &[
    "app_version",
    "doc_upsert",
    "doc_list",
    "doc_get",
    "doc_delete",
    "doc_outline",
    "asset_put",
    "asset_get",
    "search_query",
    "tag_list",
    "synonym_list",
    "synonym_save",
    "synonym_delete",
    "settings_get",
    "settings_set",
    "triage_list",
    "triage_get",
    "triage_upsert",
    "triage_delete",
    "quickref_list",
    "quickref_replace_all",
    "fav_toggle",
    "fav_list",
    "history_push",
    "history_list",
    "hotkey_list",
    "hotkey_set",
    "window_open_in_main",
    "overlay_activate",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
