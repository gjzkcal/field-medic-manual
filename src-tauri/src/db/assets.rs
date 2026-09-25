//! アセット（画像、PDF 原本）の保管。本体はデータのフォルダの `assets/<sha256>.<ext>` に置き、DB には目録だけを持つ。

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::model::AssetMeta;

const ASSET_DIR: &str = "assets";
const MAX_EXT_LEN: usize = 10;

/// アセットを保存して id（sha256）を返す。同じ内容が保存済みならファイルを書かない。
///
/// id はクライアントが計算した値を使わず、ここで計算する（内容と名前が食い違うのを防ぐため）。
///
/// # Errors
///
/// ファイル名か MIME が空なら `InvalidInput`。書き込みに失敗したら `Io`。
pub fn put(
    conn: &Connection,
    data_dir: &Path,
    bytes: &[u8],
    file_name: &str,
    mime: &str,
) -> Result<String, AppError> {
    let file_name = file_name.trim();
    let mime = mime.trim();
    if file_name.is_empty() || mime.is_empty() {
        return Err(AppError::InvalidInput(
            "アセットのファイル名と MIME が必要です".to_owned(),
        ));
    }
    let id = hex::encode(Sha256::digest(bytes));

    let existing: Option<String> = conn
        .query_row("SELECT rel_path FROM assets WHERE id = ?1", [&id], |r| {
            r.get(0)
        })
        .optional()?;
    if let Some(rel_path) = &existing
        && data_dir.join(rel_path).is_file()
    {
        return Ok(id);
    }

    let rel_path =
        existing.unwrap_or_else(|| format!("{ASSET_DIR}/{id}.{}", extension(file_name, mime)));
    let path = data_dir.join(&rel_path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // 書きかけのファイルが本物の名前で残らないよう、一時ファイルに書いてから置き換える
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;

    let size = i64::try_from(bytes.len())
        .map_err(|_| AppError::InvalidInput("アセットが大きすぎます".to_owned()))?;
    conn.execute(
        "INSERT OR IGNORE INTO assets (id, mime, file_name, rel_path, size) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, mime, file_name, rel_path, size],
    )?;
    Ok(id)
}

/// アセットの目録と中身を返す。
///
/// # Errors
///
/// 目録かファイルがなければ `NotFound`。
pub fn get(conn: &Connection, data_dir: &Path, id: &str) -> Result<(AssetMeta, Vec<u8>), AppError> {
    let (meta, rel_path): (AssetMeta, String) = conn
        .query_row(
            "SELECT id, mime, file_name, size, rel_path FROM assets WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    AssetMeta {
                        id: r.get(0)?,
                        mime: r.get(1)?,
                        file_name: r.get(2)?,
                        size: r.get(3)?,
                    },
                    r.get(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("アセット {id}")))?;
    let bytes = match std::fs::read(data_dir.join(rel_path)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound(format!("アセットのファイル {id}")));
        }
        Err(e) => return Err(e.into()),
    };
    Ok((meta, bytes))
}

/// 保存するファイルの拡張子。ファイル名の拡張子を優先し、使えなければ MIME から決める。
/// 英数字だけに限るのは、利用者のファイル名がパスの一部になるため（`..` や区切り文字を入れさせない）。
fn extension(file_name: &str, mime: &str) -> String {
    let from_name = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| {
            !e.is_empty() && e.len() <= MAX_EXT_LEN && e.chars().all(|c| c.is_ascii_alphanumeric())
        })
        .map(str::to_ascii_lowercase);
    from_name.unwrap_or_else(|| {
        match mime.to_ascii_lowercase().as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            "application/pdf" => "pdf",
            _ => "bin",
        }
        .to_owned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    #[test]
    fn stores_by_hash_and_skips_duplicates() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let id = put(&conn, dir.path(), b"png-bytes", "図 1.PNG", "image/png").expect("保存できる");
        assert_eq!(id.len(), 64);
        let path = dir.path().join(format!("assets/{id}.png"));
        assert!(path.is_file());

        let again =
            put(&conn, dir.path(), b"png-bytes", "別名.png", "image/png").expect("保存できる");
        assert_eq!(again, id);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(count, 1);

        let (meta, bytes) = get(&conn, dir.path(), &id).expect("取得できる");
        assert_eq!(bytes, b"png-bytes");
        assert_eq!(meta.file_name, "図 1.PNG");
        assert_eq!(meta.size, 9);
    }

    #[test]
    fn rewrites_missing_file() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let id = put(&conn, dir.path(), b"pdf", "a.pdf", "application/pdf").expect("保存できる");
        std::fs::remove_file(dir.path().join(format!("assets/{id}.pdf"))).expect("消せる");
        put(&conn, dir.path(), b"pdf", "a.pdf", "application/pdf").expect("保存し直せる");
        assert!(get(&conn, dir.path(), &id).is_ok());
    }

    #[test]
    fn extension_is_sanitized() {
        assert_eq!(extension("x.JPEG", "image/jpeg"), "jpeg");
        assert_eq!(extension("x", "image/jpeg"), "jpg");
        assert_eq!(extension("x.p/ng", "image/png"), "png");
        assert_eq!(extension("..", "text/plain"), "bin");
    }

    #[test]
    fn rejects_missing_meta_and_unknown_id() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        assert!(matches!(
            put(&conn, dir.path(), b"x", " ", "image/png"),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            get(&conn, dir.path(), "nope"),
            Err(AppError::NotFound(_))
        ));
    }
}
