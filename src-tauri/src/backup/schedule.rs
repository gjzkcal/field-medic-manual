//! 1 日 1 回の自動バックアップ。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::backup::store;
use crate::db::Db;

/// 起動してから最初に確かめるまでの時間。起動の直後は原稿の同期が DB を使うので、落ち着いてからにする
const FIRST_CHECK: Duration = Duration::from_mins(1);
/// 確かめる間隔。アプリはトレイに入ったまま何日も動くことがあるので、起動のときだけでは足りない
const CHECK_INTERVAL: Duration = Duration::from_hours(1);

/// 自動バックアップの見張りを始める。
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            check(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn check(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let written = app
        .state::<Db>()
        .run(move |conn, data_dir| store::write_auto_if_due(conn, data_dir, &version))
        .await;
    match written {
        Ok(Some(name)) => log::info!("自動バックアップを取りました: {name}"),
        Ok(None) => {}
        // 取れなくてもアプリは使える。次の確認でもう一度試す
        Err(error) => log::warn!("自動バックアップを取れませんでした: {error}"),
    }
}
