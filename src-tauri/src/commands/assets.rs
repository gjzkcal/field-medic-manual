use percent_encoding::percent_decode_str;
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::db::{Db, assets};
use crate::error::AppError;

/// アセットを保存し、id（sha256）を返す。
///
/// 中身は JSON にせず raw body で受け取る（大きなバイナリを数値の配列に変換すると遅く、メモリも食うため）。
/// そのため名前と MIME はヘッダで受け取る。ヘッダは ASCII しか通らないので、ファイル名は URL エンコードさせる。
///
/// # Errors
///
/// 本文が raw でない、ヘッダがない・不正なら `InvalidInput`。
#[tauri::command]
pub async fn asset_put(db: State<'_, Db>, request: Request<'_>) -> Result<String, AppError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidInput(
            "asset_put は raw body（Uint8Array）で送ってください".to_owned(),
        ));
    };
    let bytes = bytes.clone();
    let file_name = header(&request, "x-file-name")?;
    let file_name = percent_decode_str(&file_name)
        .decode_utf8()
        .map_err(|_| AppError::InvalidInput("x-file-name が UTF-8 ではありません".to_owned()))?
        .into_owned();
    let mime = header(&request, "x-mime")?;
    db.run(move |conn, data_dir| assets::put(conn, data_dir, &bytes, &file_name, &mime))
        .await
}

/// アセットの中身を返す。TS 側では `ArrayBuffer` として受け取る。
///
/// # Errors
///
/// 見つからなければ `NotFound`。
#[tauri::command]
pub async fn asset_get(db: State<'_, Db>, id: String) -> Result<Response, AppError> {
    let (_, bytes) = db
        .run(move |conn, data_dir| assets::get(conn, data_dir, &id))
        .await?;
    Ok(Response::new(bytes))
}

fn header(request: &Request<'_>, name: &str) -> Result<String, AppError> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| AppError::InvalidInput(format!("ヘッダ {name} がありません")))
}
