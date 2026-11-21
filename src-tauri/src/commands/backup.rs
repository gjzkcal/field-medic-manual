//! バックアップと復元。メインのウィンドウだけに許す（capabilities/main.json）。
//! 画面からパスは受け取らない。場所は、OS のダイアログで利用者が選んだものか、アプリが決めたフォルダの中だけにする。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::backup::pending::PendingRestore;
use crate::backup::{dialog, store};
use crate::db::{Db, backup};
use crate::error::AppError;
use crate::model::{BackupEntry, BackupKind, BackupPreview, ExportResult};
use crate::window::overlay;

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// アプリが取ったバックアップ（毎日の分と、復元の前の分）を新しい順に返す。
///
/// # Errors
///
/// フォルダを読めない場合。
#[tauri::command]
pub async fn backup_list(db: State<'_, Db>) -> Result<Vec<BackupEntry>, AppError> {
    db.run(|_, data_dir| store::list(data_dir)).await
}

/// 保存先を選んでもらい、今の状態を 1 つのファイルに書き出す。取り消したら `null`。
///
/// # Errors
///
/// DB を読めない、ファイルを書けない場合。
#[tauri::command]
pub async fn backup_export(
    window: WebviewWindow,
    db: State<'_, Db>,
) -> Result<Option<ExportResult>, AppError> {
    let version = window.app_handle().package_info().version.to_string();
    let default_name = db.run(|conn, _| store::export_file_name(conn)).await?;
    let Some(path) = dialog::pick_save(&window, &default_name).await? else {
        return Ok(None);
    };
    let result = db
        .run(move |conn, _| {
            let (bytes, file, stats) = store::serialize(conn, BackupKind::Manual, &version)?;
            store::write_atomic(&path, &bytes)?;
            Ok(ExportResult {
                // フォルダは返さない（ユーザー名が画面とログに出ないように）
                file_name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                favorites: count(file.favorites.len()),
                history: count(file.history.len()),
                skipped: count(stats.skipped),
            })
        })
        .await?;
    log::info!(
        "バックアップを書き出しました: お気に入り {} 件・履歴 {} 件",
        result.favorites,
        result.history
    );
    Ok(Some(result))
}

/// 復元するファイルを選んでもらい、確かめる内容を返す。取り消したら `null`。
///
/// # Errors
///
/// 読めない場合。バックアップのファイルでない、形や大きさが合わない場合は `InvalidInput`。
#[tauri::command]
pub async fn backup_open_file(
    window: WebviewWindow,
    db: State<'_, Db>,
    pending: State<'_, PendingRestore>,
) -> Result<Option<BackupPreview>, AppError> {
    let Some(path) = dialog::pick_open(&window).await? else {
        return Ok(None);
    };
    read_for_restore(&db, &pending, move |_| Ok(path))
        .await
        .map(Some)
}

/// アプリが取ったバックアップを 1 つ選び、確かめる内容を返す。`id` は `backup_list` が返した名前。
///
/// # Errors
///
/// 一覧に無い名前なら `InvalidInput`。読めない、形が合わない場合。
#[tauri::command]
pub async fn backup_open_auto(
    db: State<'_, Db>,
    pending: State<'_, PendingRestore>,
    id: String,
) -> Result<BackupPreview, AppError> {
    read_for_restore(&db, &pending, move |data_dir| store::path_of(data_dir, &id)).await
}

/// ファイルを読んで確かめ、中身を預かって、確認の画面に出す内容を作る。
async fn read_for_restore<F>(
    db: &Db,
    pending: &PendingRestore,
    path: F,
) -> Result<BackupPreview, AppError>
where
    F: FnOnce(&Path) -> Result<PathBuf, AppError> + Send + 'static,
{
    let (valid, counts) = db
        .run(move |conn, data_dir| {
            let bytes = store::read(&path(data_dir)?)?;
            let valid = backup::validate(backup::parse(&bytes)?)?;
            let counts = backup::preview(conn, &valid)?;
            Ok((valid, counts))
        })
        .await?;
    let file = valid.file();
    let preview = BackupPreview {
        token: String::new(),
        kind: file.kind,
        created_at: file.created_at.clone(),
        app_version: file.app_version.clone(),
        favorites: count(counts.favorites),
        history: count(counts.history),
        settings: file.settings.keys().cloned().collect(),
        unresolved_favorites: count(counts.unresolved_favorites),
        unresolved_history: count(counts.unresolved_history),
        skipped_settings: valid.skipped_settings().to_vec(),
    };
    Ok(BackupPreview {
        token: pending.hold(valid),
        ..preview
    })
}

/// 確かめたバックアップで、お気に入り・履歴・設定を置き換え、アプリを再起動する。
///
/// 置き換える前に、今の状態を「復元の前」のバックアップとして書く（間違えて復元しても戻せるように）。
/// 再起動するのは、開いている画面が持っている古い設定で、復元した値を上書きさせないため。
///
/// # Errors
///
/// 合い言葉が合わなければ `InvalidInput`。今の状態を書けない、DB を書けない場合（そのときは何も変えない）。
#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    db: State<'_, Db>,
    pending: State<'_, PendingRestore>,
    token: String,
) -> Result<(), AppError> {
    let Some(valid) = pending.take(&token) else {
        return Err(AppError::InvalidInput(
            "復元するバックアップを、もう一度選んでください".to_owned(),
        ));
    };
    let version = app.package_info().version.to_string();
    let counts = db
        .run(move |conn, data_dir| {
            // 同じ接続を持ったまま続けて行う。取った状態と置き換える直前の状態の間に、ほかの書き込みを挟ませない
            store::write_snapshot(conn, data_dir, BackupKind::BeforeRestore, &version)?;
            backup::apply(conn, &valid)
        })
        .await?;
    log::info!(
        "バックアップから復元しました: お気に入り {} 件・履歴 {} 件（戻せなかった分 {} 件・{} 件）。再起動します",
        counts.favorites,
        counts.history,
        counts.unresolved_favorites,
        counts.unresolved_history
    );
    // 小窓も古い設定を持っている。再起動までの間に書かせない
    if let Some(window) = app.get_webview_window(overlay::OVERLAY) {
        let _ = window.hide();
    }
    app.request_restart();
    Ok(())
}
