//! バックアップのファイルの置き場所と、読み書き。
//!
//! アプリが取る分（毎日の分と、復元の前の分）は、データのフォルダの `backups/` に、アプリが付けた名前で置く。
//! 画面から受け取るのは一覧に出した名前だけで、形を確かめてからパスにする（任意のファイルを読ませないため）。

use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::backup::{self, BackupFile, ExportStats, MAX_BACKUP_BYTES};
use crate::error::AppError;
use crate::model::{BackupEntry, BackupKind};

const BACKUP_DIR: &str = "backups";
const EXTENSION: &str = ".json";
const AUTO_PREFIX: &str = "auto-";
const BEFORE_RESTORE_PREFIX: &str = "before-restore-";
/// `YYYYMMDDTHHMMSSZ`
const STAMP_LEN: usize = 16;

/// 毎日の分を残す数
pub const KEEP_AUTO: usize = 7;
/// 復元の前の分を残す数。毎日の分とは別に数える（復元を繰り返しても、毎日の分を押し出さないため）
pub const KEEP_BEFORE_RESTORE: usize = 3;

#[must_use]
pub fn backups_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(BACKUP_DIR)
}

/// 名前に入れる時刻（UTC）。同じ長さの数字なので、文字列どうしを比べれば時刻の前後になる。
/// 日時のクレートを増やさないため `SQLite` に作らせる。`modifier` は `'-1 day'` など。
fn stamp(conn: &Connection, modifier: Option<&str>) -> Result<String, AppError> {
    let stamp = match modifier {
        Some(modifier) => conn.query_row(
            "SELECT strftime('%Y%m%dT%H%M%SZ', 'now', ?1)",
            [modifier],
            |row| row.get(0),
        )?,
        None => conn.query_row("SELECT strftime('%Y%m%dT%H%M%SZ', 'now')", [], |row| {
            row.get(0)
        })?,
    };
    Ok(stamp)
}

const fn prefix(kind: BackupKind) -> Option<&'static str> {
    match kind {
        BackupKind::Auto => Some(AUTO_PREFIX),
        BackupKind::BeforeRestore => Some(BEFORE_RESTORE_PREFIX),
        // 利用者が書き出した分は、利用者が選んだ場所に置く。このフォルダには置かない
        BackupKind::Manual => None,
    }
}

/// アプリが付けた名前なら、種類と時刻を返す。それ以外（パスの区切りや `..` を含むものも）は None。
#[must_use]
pub fn parse_name(name: &str) -> Option<(BackupKind, &str)> {
    let body = name.strip_suffix(EXTENSION)?;
    let (kind, stamp) = [BackupKind::Auto, BackupKind::BeforeRestore]
        .into_iter()
        .find_map(|kind| Some((kind, body.strip_prefix(prefix(kind)?)?)))?;
    let bytes = stamp.as_bytes();
    let shaped = bytes.len() == STAMP_LEN
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 => *b == b'T',
            15 => *b == b'Z',
            _ => b.is_ascii_digit(),
        });
    shaped.then_some((kind, stamp))
}

/// 名前の時刻を、画面に渡す形（ISO 8601）に直す。
fn iso_of(stamp: &str) -> String {
    format!(
        "{}-{}-{}T{}:{}:{}Z",
        &stamp[0..4],
        &stamp[4..6],
        &stamp[6..8],
        &stamp[9..11],
        &stamp[11..13],
        &stamp[13..15]
    )
}

/// `backups/` にある、アプリが取ったバックアップ。新しい順。
///
/// # Errors
///
/// フォルダを読めない場合（フォルダが無いのは、まだ 1 つも取っていないだけなので空を返す）。
pub fn list(data_dir: &Path) -> Result<Vec<BackupEntry>, AppError> {
    let dir = backups_dir(data_dir);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut found = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let Some((kind, stamp)) = parse_name(&name) else {
            continue;
        };
        // リンクをたどらない。このフォルダに置いたリンクの先を、バックアップとして読んだり消したりしないため
        let meta = std::fs::symlink_metadata(entry.path())?;
        if !meta.is_file() {
            continue;
        }
        found.push((
            stamp.to_owned(),
            BackupEntry {
                kind,
                created_at: iso_of(stamp),
                size_bytes: u32::try_from(meta.len()).unwrap_or(u32::MAX),
                id: name,
            },
        ));
    }
    // 同じ時刻なら、復元の前の分を先にする（並びを毎回同じにするため）
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.id.cmp(&a.1.id)));
    Ok(found.into_iter().map(|(_, entry)| entry).collect())
}

/// 一覧に出した名前から、そのファイルのパスを作る。
///
/// # Errors
///
/// 名前の形が合わない、または今の一覧に無ければ `InvalidInput`。
pub fn path_of(data_dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    let known = parse_name(id).is_some() && list(data_dir)?.iter().any(|entry| entry.id == id);
    if known {
        Ok(backups_dir(data_dir).join(id))
    } else {
        Err(AppError::InvalidInput(
            "そのバックアップは見つかりません。一覧を読み直してください".to_owned(),
        ))
    }
}

/// ファイルを、上限の大きさまで読む。
///
/// # Errors
///
/// 読めない場合は `Io`、大きすぎれば `InvalidInput`。
pub fn read(path: &Path) -> Result<Vec<u8>, AppError> {
    let too_large = || {
        AppError::InvalidInput(
            "ファイルが大きすぎます。バックアップのファイルではありません".to_owned(),
        )
    };
    let file = std::fs::File::open(path)?;
    let limit = u64::try_from(MAX_BACKUP_BYTES).unwrap_or(u64::MAX);
    if file.metadata()?.len() > limit {
        return Err(too_large());
    }
    // 大きさを見た後に書き足されても、上限を超えては読まない
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

/// 書きかけのファイルが本物の名前で残らないよう、一時ファイルに書いてから置き換える。
///
/// # Errors
///
/// フォルダを作れない、書けない場合。
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // 一時ファイルの名前は毎回変える。利用者が選んだフォルダにも書くので、
    // 決まった名前（`<名前>.tmp`）にすると、そこにあった別のファイルを上書きしうる
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
    let tmp = path.with_file_name(tmp_name);
    let written = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path));
    if written.is_err() {
        // 書きかけを残さない。消せなくても、返すのは元の失敗
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(written?)
}

/// ファイルに書く中身を作る。書いたものを復元できないことが無いよう、復元と同じ検査に通してから返す。
///
/// # Errors
///
/// DB を読めない、または中身が復元の検査に通らない場合。
pub fn serialize(
    conn: &Connection,
    kind: BackupKind,
    app_version: &str,
) -> Result<(Vec<u8>, BackupFile, ExportStats), AppError> {
    let (file, stats) = backup::export(conn, kind, app_version)?;
    let bytes = serde_json::to_vec_pretty(&file)
        .map_err(|e| AppError::Internal(format!("バックアップを JSON にできません: {e}")))?;
    backup::validate(backup::parse(&bytes)?)
        .map_err(|e| AppError::Internal(format!("作ったバックアップが検査に通りません: {e}")))?;
    Ok((bytes, file, stats))
}

/// 今の状態を `backups/` に書き、古いものを刈る。書いたファイルの名前を返す。
///
/// # Errors
///
/// DB を読めない、ファイルを書けない場合。`Manual` は `InvalidInput`（このフォルダには置かない）。
pub fn write_snapshot(
    conn: &Connection,
    data_dir: &Path,
    kind: BackupKind,
    app_version: &str,
) -> Result<String, AppError> {
    let Some(prefix) = prefix(kind) else {
        return Err(AppError::InvalidInput(
            "この種類のバックアップは、保存先を選んで書き出します".to_owned(),
        ));
    };
    let (bytes, _, _) = serialize(conn, kind, app_version)?;
    let name = format!("{prefix}{}{EXTENSION}", stamp(conn, None)?);
    write_atomic(&backups_dir(data_dir).join(&name), &bytes)?;
    let keep = match kind {
        BackupKind::BeforeRestore => KEEP_BEFORE_RESTORE,
        BackupKind::Auto | BackupKind::Manual => KEEP_AUTO,
    };
    rotate(data_dir, kind, keep)?;
    Ok(name)
}

/// その種類のバックアップを、新しい順に `keep` 個だけ残す。
fn rotate(data_dir: &Path, kind: BackupKind, keep: usize) -> Result<(), AppError> {
    let dir = backups_dir(data_dir);
    let old = list(data_dir)?
        .into_iter()
        .filter(|entry| entry.kind == kind)
        .skip(keep);
    for entry in old {
        std::fs::remove_file(dir.join(entry.id))?;
    }
    Ok(())
}

/// 利用者に見せる、書き出すファイルの名前の案（保存先のダイアログに出す）。
///
/// # Errors
///
/// DB から時刻を取れない場合。
pub fn export_file_name(conn: &Connection) -> Result<String, AppError> {
    Ok(format!(
        "field-medic-manual-backup-{}{EXTENSION}",
        stamp(conn, None)?
    ))
}

/// 毎日の分を取る時か。`latest` は今ある毎日の分のうち最新の時刻。
fn is_due(latest: Option<&str>, now: &str, day_ago: &str) -> bool {
    match latest {
        None => true,
        // 最新が未来の時刻（PC の時計を戻したなど）なら、待っても 24 時間たったことにならないので取る
        Some(latest) => latest <= day_ago || latest > now,
    }
}

/// 最後の毎日の分から 24 時間たっていれば、今の状態を書く。書いたら、その名前を返す。
///
/// # Errors
///
/// DB を読めない、ファイルを書けない場合。
pub fn write_auto_if_due(
    conn: &Connection,
    data_dir: &Path,
    app_version: &str,
) -> Result<Option<String>, AppError> {
    let latest = list(data_dir)?
        .into_iter()
        .find(|entry| entry.kind == BackupKind::Auto)
        .and_then(|entry| parse_name(&entry.id).map(|(_, stamp)| stamp.to_owned()));
    let now = stamp(conn, None)?;
    let day_ago = stamp(conn, Some("-1 day"))?;
    if !is_due(latest.as_deref(), &now, &day_ago) {
        return Ok(None);
    }
    write_snapshot(conn, data_dir, BackupKind::Auto, app_version).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn names(data_dir: &Path) -> Vec<String> {
        list(data_dir)
            .expect("読める")
            .into_iter()
            .map(|entry| entry.id)
            .collect()
    }

    fn touch(data_dir: &Path, name: &str) {
        write_atomic(&backups_dir(data_dir).join(name), b"{}").expect("書ける");
    }

    #[test]
    fn only_names_the_app_gives_are_accepted() {
        assert_eq!(
            parse_name("auto-20261121T093000Z.json"),
            Some((BackupKind::Auto, "20261121T093000Z"))
        );
        assert_eq!(
            parse_name("before-restore-20261121T093000Z.json"),
            Some((BackupKind::BeforeRestore, "20261121T093000Z"))
        );
        for name in [
            "",
            "auto-20261121T093000Z",
            "auto-20261121T093000Z.json.exe",
            "auto-2026112XT093000Z.json",
            "auto-20261121T093000Z.JSON",
            "auto-20261121 093000Z.json",
            "../auto-20261121T093000Z.json",
            "..\\auto-20261121T093000Z.json",
            "C:\\Users\\x\\auto-20261121T093000Z.json",
            "backups/auto-20261121T093000Z.json",
            "manual-20261121T093000Z.json",
            "field-medic-manual-backup-20261121T093000Z.json",
            "auto-20261121T093000Z.json\0",
        ] {
            assert_eq!(parse_name(name), None, "{name:?}");
        }
    }

    #[test]
    fn list_is_newest_first_and_ignores_other_files() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        assert_eq!(names(dir.path()), Vec::<String>::new());

        touch(dir.path(), "auto-20261120T000000Z.json");
        touch(dir.path(), "before-restore-20261121T120000Z.json");
        touch(dir.path(), "auto-20261121T000000Z.json");
        touch(dir.path(), "notes.txt");
        touch(dir.path(), "auto-20261121T000000Z.tmp");
        std::fs::create_dir(backups_dir(dir.path()).join("auto-20261119T000000Z.json"))
            .expect("フォルダを作れる");

        let entries = list(dir.path()).expect("読める");
        assert_eq!(
            entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec![
                "before-restore-20261121T120000Z.json",
                "auto-20261121T000000Z.json",
                "auto-20261120T000000Z.json",
            ]
        );
        assert_eq!(entries[0].kind, BackupKind::BeforeRestore);
        assert_eq!(entries[0].created_at, "2026-11-21T12:00:00Z");
        assert_eq!(entries[0].size_bytes, 2);
    }

    #[test]
    fn path_is_given_only_for_listed_names() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        touch(dir.path(), "auto-20261121T000000Z.json");
        assert_eq!(
            path_of(dir.path(), "auto-20261121T000000Z.json").expect("パスにできる"),
            backups_dir(dir.path()).join("auto-20261121T000000Z.json")
        );
        for id in [
            // 形は合うが、一覧に無い
            "auto-20261122T000000Z.json",
            "../field-medic.db",
            "notes.txt",
        ] {
            assert!(
                matches!(path_of(dir.path(), id), Err(AppError::InvalidInput(_))),
                "{id}"
            );
        }
    }

    #[test]
    fn rotation_keeps_each_kind_separately() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        for day in 10..20 {
            touch(dir.path(), &format!("auto-202611{day}T000000Z.json"));
        }
        for hour in 10..15 {
            touch(
                dir.path(),
                &format!("before-restore-20261101T{hour}0000Z.json"),
            );
        }
        touch(dir.path(), "notes.txt");

        rotate(dir.path(), BackupKind::Auto, KEEP_AUTO).expect("刈れる");
        rotate(dir.path(), BackupKind::BeforeRestore, KEEP_BEFORE_RESTORE).expect("刈れる");

        let left = names(dir.path());
        assert_eq!(left.iter().filter(|n| n.starts_with("auto-")).count(), 7);
        assert!(left.contains(&"auto-20261119T000000Z.json".to_owned()));
        assert!(!left.contains(&"auto-20261112T000000Z.json".to_owned()));
        assert_eq!(
            left.iter()
                .filter(|n| n.starts_with("before-restore-"))
                .collect::<Vec<_>>(),
            vec![
                "before-restore-20261101T140000Z.json",
                "before-restore-20261101T130000Z.json",
                "before-restore-20261101T120000Z.json",
            ]
        );
        // アプリが付けた名前でないファイルは、消さない
        assert!(backups_dir(dir.path()).join("notes.txt").is_file());
    }

    #[test]
    fn auto_backup_is_due_once_a_day() {
        let now = "20261121T120000Z";
        let day_ago = "20261120T120000Z";
        assert!(is_due(None, now, day_ago));
        assert!(is_due(Some("20261120T115959Z"), now, day_ago));
        assert!(is_due(Some("20261120T120000Z"), now, day_ago));
        assert!(!is_due(Some("20261120T120001Z"), now, day_ago));
        assert!(!is_due(Some(now), now, day_ago));
        // PC の時計を戻したとき。未来の時刻のファイルを待ち続けない
        assert!(is_due(Some("20261201T000000Z"), now, day_ago));
    }

    #[test]
    fn auto_backup_is_written_once_and_can_be_read_back() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let conn = test_conn();
        let name = write_auto_if_due(&conn, dir.path(), "0.9.0")
            .expect("書ける")
            .expect("最初は必ず取る");
        assert_eq!(
            parse_name(&name).map(|(kind, _)| kind),
            Some(BackupKind::Auto)
        );
        // 取ったばかりなので、もう取らない
        assert_eq!(
            write_auto_if_due(&conn, dir.path(), "0.9.0").expect("読める"),
            None
        );

        let bytes = read(&path_of(dir.path(), &name).expect("パスにできる")).expect("読める");
        let file = backup::parse(&bytes).expect("読める");
        assert_eq!(file.kind, BackupKind::Auto);
        assert_eq!(file.app_version, "0.9.0");
        // 書きかけのファイルを残さない
        assert_eq!(names(dir.path()), vec![name]);
        assert_eq!(
            std::fs::read_dir(backups_dir(dir.path()))
                .expect("読める")
                .count(),
            1
        );
    }

    #[test]
    fn manual_backups_are_not_written_into_the_app_folder() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let conn = test_conn();
        assert!(matches!(
            write_snapshot(&conn, dir.path(), BackupKind::Manual, "0.9.0"),
            Err(AppError::InvalidInput(_))
        ));
        assert!(
            export_file_name(&conn)
                .expect("名前を作れる")
                .starts_with("field-medic-manual-backup-2")
        );
    }

    #[test]
    fn oversized_files_are_not_read() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        let path = dir.path().join("big.json");
        std::fs::write(&path, vec![b' '; MAX_BACKUP_BYTES + 1]).expect("書ける");
        assert!(matches!(read(&path), Err(AppError::InvalidInput(_))));
        assert!(matches!(
            read(&dir.path().join("missing.json")),
            Err(AppError::Io(_))
        ));
    }
}
