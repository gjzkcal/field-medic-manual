//! アセット（画像）の保管。本体はデータのフォルダの `assets/<sha256>.<ext>` に置き、DB には目録だけを持つ。

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use super::text::{MAX_SHORT_TEXT, check_len};
use crate::error::AppError;
use crate::model::AssetMeta;

const ASSET_DIR: &str = "assets";
/// 1 つのアセットの大きさの上限。原稿の図にはこれで足り、データのフォルダを際限なく太らせないため
const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
/// sha256 の 16 進の長さ
const ASSET_ID_LEN: usize = 64;

/// アセットを保存して id（sha256）を返す。同じ内容が保存済みならファイルを書かない。
///
/// id はクライアントが計算した値を使わず、ここで計算する（内容と名前が食い違うのを防ぐため）。
///
/// # Errors
///
/// ファイル名か MIME が空か不正、大きすぎる、中身が MIME と合わなければ `InvalidInput`。書き込みに失敗したら `Io`。
pub fn put(
    conn: &Connection,
    data_dir: &Path,
    bytes: &[u8],
    file_name: &str,
    mime: &str,
) -> Result<String, AppError> {
    let file_name = file_name.trim();
    let mime = mime.trim().to_ascii_lowercase();
    if file_name.is_empty() || mime.is_empty() {
        return Err(AppError::InvalidInput(
            "アセットのファイル名と MIME が必要です".to_owned(),
        ));
    }
    check_len("アセットのファイル名", file_name, MAX_SHORT_TEXT)?;
    if file_name.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "アセットのファイル名に制御文字は使えません".to_owned(),
        ));
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(AppError::InvalidInput(format!(
            "アセットは {MAX_ASSET_BYTES} バイトまでです"
        )));
    }
    let extension = extension(&mime)
        .ok_or_else(|| AppError::InvalidInput(format!("使えない種類のアセットです: {mime}")))?;
    if !has_signature(&mime, bytes) {
        return Err(AppError::InvalidInput(format!(
            "アセットの中身が {mime} ではありません"
        )));
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

    let rel_path = existing.unwrap_or_else(|| format!("{ASSET_DIR}/{id}.{extension}"));
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
/// id の形が不正なら `InvalidInput`。目録かファイルがなければ `NotFound`。
pub fn get(conn: &Connection, data_dir: &Path, id: &str) -> Result<(AssetMeta, Vec<u8>), AppError> {
    if !is_asset_id(id) {
        return Err(AppError::InvalidInput(
            "アセットの id の形が不正です".to_owned(),
        ));
    }
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

fn is_asset_id(id: &str) -> bool {
    id.len() == ASSET_ID_LEN && id.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
}

/// 受け付ける MIME と、保存するファイルの拡張子。利用者のファイル名を拡張子に使わないのは、
/// `.exe` や `.html` のファイルをデータのフォルダに作らせないため。
/// SVG はスクリプトを含められるので受け付けない。
fn extension(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

/// 先頭のバイト列が MIME と合うか。送られた MIME を信じると、別の形式を画像として保存できてしまう。
fn has_signature(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nbytes";

    #[test]
    fn stores_by_hash_and_skips_duplicates() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let id = put(&conn, dir.path(), PNG, "図 1.PNG", "image/png").expect("保存できる");
        assert_eq!(id.len(), 64);
        let path = dir.path().join(format!("assets/{id}.png"));
        assert!(path.is_file());

        let again = put(&conn, dir.path(), PNG, "別名.png", "IMAGE/PNG").expect("保存できる");
        assert_eq!(again, id);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(count, 1);

        let (meta, bytes) = get(&conn, dir.path(), &id).expect("取得できる");
        assert_eq!(bytes, PNG);
        assert_eq!(meta.file_name, "図 1.PNG");
        assert_eq!(meta.size, 13);
    }

    #[test]
    fn rewrites_missing_file() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let id = put(&conn, dir.path(), PNG, "a.png", "image/png").expect("保存できる");
        std::fs::remove_file(dir.path().join(format!("assets/{id}.png"))).expect("消せる");
        put(&conn, dir.path(), PNG, "a.png", "image/png").expect("保存し直せる");
        assert!(get(&conn, dir.path(), &id).is_ok());
    }

    #[test]
    fn extension_comes_from_mime_not_file_name() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let id = put(&conn, dir.path(), PNG, "evil.exe", "image/png").expect("保存できる");
        assert!(dir.path().join(format!("assets/{id}.png")).is_file());
        assert!(!dir.path().join(format!("assets/{id}.exe")).exists());
    }

    #[test]
    fn accepts_each_image_signature() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let samples: [(&[u8], &str); 4] = [
            (PNG, "image/png"),
            (&[0xFF, 0xD8, 0xFF, 0xE0], "image/jpeg"),
            (b"GIF89a....", "image/gif"),
            (b"RIFF....WEBPVP8 ", "image/webp"),
        ];
        for (bytes, mime) in samples {
            assert!(put(&conn, dir.path(), bytes, "a", mime).is_ok(), "{mime}");
        }
    }

    #[test]
    fn rejects_files_that_are_not_allowed_images() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let oversize = [PNG, &vec![0; MAX_ASSET_BYTES]].concat();
        let long_name = "a".repeat(MAX_SHORT_TEXT + 1);
        let cases: [(&[u8], &str, &str, &str); 7] = [
            (b"<svg onload=alert(1)>", "a.svg", "image/svg+xml", "SVG"),
            (b"%PDF-1.7", "a.pdf", "application/pdf", "PDF"),
            (b"MZ", "a.png", "image/png", "中身が PNG でない"),
            (
                b"RIFF....WAVE",
                "a.webp",
                "image/webp",
                "RIFF だが WebP でない",
            ),
            (&oversize, "a.png", "image/png", "大きすぎる"),
            (PNG, &long_name, "image/png", "名前が長すぎる"),
            (PNG, "a\n.png", "image/png", "名前に制御文字"),
        ];
        for (bytes, name, mime, case) in cases {
            assert!(
                matches!(
                    put(&conn, dir.path(), bytes, name, mime),
                    Err(AppError::InvalidInput(_))
                ),
                "{case}"
            );
        }
    }

    #[test]
    fn rejects_missing_meta_and_unknown_id() {
        let conn = test_conn();
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        assert!(matches!(
            put(&conn, dir.path(), PNG, " ", "image/png"),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            get(&conn, dir.path(), &"0".repeat(ASSET_ID_LEN)),
            Err(AppError::NotFound(_))
        ));
        for id in ["nope", "../field-medic.db", &"A".repeat(ASSET_ID_LEN)] {
            assert!(
                matches!(get(&conn, dir.path(), id), Err(AppError::InvalidInput(_))),
                "{id}"
            );
        }
    }
}
