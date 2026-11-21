//! 利用者のデータ（お気に入り・履歴・設定・ホットキー）の書き出しと復元。ここは DB だけを扱い、ファイルには触らない。
//!
//! DB のファイルを丸ごと写さず、版付きの JSON にする。文書の id はインストールごとに違う UUID なので、
//! そのまま戻すと、入れ直した後や別の PC では、お気に入りと履歴が全部どの文書も指さなくなる。
//! 書き出すときに原稿の `source_path` に直し、復元のときに今の DB の id に引き直す。
//!
//! 同義語の辞書は入れない。編集する画面が無く中身は初期値のままなので、入れると、
//! 後の版で足した初期値を古いバックアップが消してしまう。負傷者の記録（終了で消す）と API キーも入れない。

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::{prefs, settings};
use crate::error::AppError;
use crate::model::BackupKind;
use crate::window::hotkey;

/// ほかの JSON と見分ける印
pub const FORMAT: &str = "field-medic-manual-backup";
/// ファイルの形の版。形を互換なしに変えたら上げ、古い版を読む変換を足す
pub const VERSION: u32 = 1;
/// 受け付けるファイルの大きさ。上限いっぱいのお気に入り・履歴・設定で 2 MiB に届かないので、桁違いに大きいものは別のファイルとみなす
pub const MAX_BACKUP_BYTES: usize = 8 * 1024 * 1024;

const MAX_SOURCE_LEN: usize = 1024;
/// 節は DB で `<文書の id（UUID の 36 文字）>#<アンカー>` の 1 つの文字列にする。その全体が `MAX_ID_LEN` に収まる長さ
const MAX_ANCHOR_LEN: usize = prefs::MAX_ID_LEN - 37;
const MAX_TIMESTAMP_LEN: usize = 32;
const MAX_APP_VERSION_LEN: usize = 64;

/// バックアップのファイルの中身。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupFile {
    pub format: String,
    pub version: u32,
    /// 作ったアプリの版と DB の版。調べるときの手がかりで、復元の判定には使わない
    pub app_version: String,
    pub db_version: u32,
    pub created_at: String,
    pub kind: BackupKind,
    pub favorites: Vec<FavoriteEntry>,
    /// 古い順（同じ順に入れ直すと、「最後に開いた順」が元どおりになる）
    pub history: Vec<HistoryEntry>,
    pub settings: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FavoriteEntry {
    pub target: BackupTarget,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryEntry {
    pub target: BackupTarget,
    pub viewed_at: String,
}

/// お気に入り・履歴の対象。文書は id ではなく原稿の場所（`source_path`）で指す。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BackupTarget {
    Section {
        source: String,
        anchor: String,
    },
    Document {
        source: String,
    },
    #[serde(rename_all = "camelCase")]
    Flow {
        flow_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Quickref {
        row_id: String,
    },
}

/// 検査を通ったバックアップ。復元はこの型だけを受ける（検査していない中身を DB に入れないため）。
#[derive(Debug, Clone, PartialEq)]
pub struct ValidBackup {
    file: BackupFile,
    /// このアプリが知らないので入れない設定のキー
    skipped_settings: Vec<String>,
}

impl ValidBackup {
    #[must_use]
    pub const fn file(&self) -> &BackupFile {
        &self.file
    }

    #[must_use]
    pub fn skipped_settings(&self) -> &[String] {
        &self.skipped_settings
    }
}

/// 書き出しで入れられなかった行の数（原稿がもう DB に無いものなど）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ExportStats {
    pub skipped: usize,
}

/// 復元で入れる件数と、今のマニュアルに原稿が見つからず入れられない件数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RestoreCounts {
    pub favorites: usize,
    pub history: usize,
    pub unresolved_favorites: usize,
    pub unresolved_history: usize,
}

/// バックアップに入れる設定のキー（画面の設定と、ホットキー）。
fn managed_keys() -> impl Iterator<Item = &'static str> {
    settings::KNOWN_KEYS
        .into_iter()
        .chain(std::iter::once(hotkey::SETTINGS_KEY))
}

/// 今の DB から、バックアップの中身を作る。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn export(
    conn: &Connection,
    kind: BackupKind,
    app_version: &str,
) -> Result<(BackupFile, ExportStats), AppError> {
    let mut stats = ExportStats::default();
    let mut sources = SourceById::default();

    let mut favorites = Vec::new();
    // 入れた順（復元で同じ順に入れると、同じ時刻のものも元の並びになる）
    for (kind, id, created_at) in read_rows(
        conn,
        "SELECT target_type, target_id, created_at FROM favorites ORDER BY created_at, rowid",
    )? {
        match sources.backup_target(conn, &kind, &id)? {
            Some(target) => favorites.push(FavoriteEntry { target, created_at }),
            None => stats.skipped += 1,
        }
    }

    let mut history = Vec::new();
    for (kind, id, viewed_at) in read_rows(
        conn,
        "SELECT target_type, target_id, viewed_at FROM history ORDER BY id",
    )? {
        match sources.backup_target(conn, &kind, &id)? {
            Some(target) => history.push(HistoryEntry { target, viewed_at }),
            None => stats.skipped += 1,
        }
    }

    let mut saved = Map::new();
    for key in managed_keys() {
        // 読めない値（壊れた JSON）が 1 つあるだけで、バックアップが毎回失敗し続けないようにする。
        // 入れても復元の検査で落ちる値は、ここで外す（書いたファイルを復元できないことを避ける）
        match settings::get(conn, key) {
            Ok(Some(value)) if settings::check_value(&value).is_ok() => {
                saved.insert(key.to_owned(), value);
            }
            Ok(Some(_)) | Err(_) => {
                log::warn!("設定 {key} は形が合わないので、バックアップに入れません");
                stats.skipped += 1;
            }
            Ok(None) => {}
        }
    }

    let db_version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let file = BackupFile {
        format: FORMAT.to_owned(),
        version: VERSION,
        app_version: app_version.to_owned(),
        db_version,
        created_at: super::now(conn)?,
        kind,
        favorites,
        history,
        settings: saved,
    };
    Ok((file, stats))
}

fn read_rows(conn: &Connection, sql: &str) -> Result<Vec<(String, String, String)>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 文書の id から原稿の場所を引く。同じ文書を何度も引かないよう覚えておく。
#[derive(Default)]
struct SourceById(HashMap<String, Option<String>>);

impl SourceById {
    fn get(&mut self, conn: &Connection, document_id: &str) -> Result<Option<String>, AppError> {
        if let Some(known) = self.0.get(document_id) {
            return Ok(known.clone());
        }
        let source: Option<String> = conn
            .query_row(
                "SELECT source_path FROM documents WHERE id = ?1",
                [document_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        self.0.insert(document_id.to_owned(), source.clone());
        Ok(source)
    }

    /// DB の行をバックアップの対象に直す。原稿がもう無い文書を指す行と、知らない種類の行は None。
    fn backup_target(
        &mut self,
        conn: &Connection,
        kind: &str,
        id: &str,
    ) -> Result<Option<BackupTarget>, AppError> {
        Ok(match kind {
            prefs::SECTION => {
                let Some((document_id, anchor)) = id.split_once('#') else {
                    return Ok(None);
                };
                self.get(conn, document_id)?
                    .map(|source| BackupTarget::Section {
                        source,
                        anchor: anchor.to_owned(),
                    })
            }
            prefs::DOCUMENT => self
                .get(conn, id)?
                .map(|source| BackupTarget::Document { source }),
            prefs::FLOW => Some(BackupTarget::Flow {
                flow_id: id.to_owned(),
            }),
            prefs::QUICKREF => Some(BackupTarget::Quickref {
                row_id: id.to_owned(),
            }),
            _ => None,
        })
    }
}

/// ファイルの中身を読む。大きさ・印・版を先に確かめ、利用者に分かる理由で断る。
///
/// # Errors
///
/// 大きすぎる、JSON でない、このアプリのバックアップでない、新しい版で作られた、形が合わない場合は `InvalidInput`。
pub fn parse(bytes: &[u8]) -> Result<BackupFile, AppError> {
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err(invalid(
            "ファイルが大きすぎます。バックアップのファイルではありません",
        ));
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| invalid("バックアップのファイルではありません（JSON として読めません）"))?;
    if value.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(invalid("このアプリのバックアップのファイルではありません"));
    }
    match value.get("version").and_then(Value::as_u64) {
        Some(version) if version > u64::from(VERSION) => {
            return Err(invalid(
                "新しい版のアプリで作ったバックアップです。アプリを更新してから復元してください",
            ));
        }
        Some(version) if version >= 1 => {}
        _ => return Err(invalid("バックアップの版を読めません")),
    }
    // 知らない項目も断る（deny_unknown_fields）。黙って捨てると、戻したつもりのものが戻らない
    serde_json::from_value(value)
        .map_err(|e| invalid(&format!("バックアップの形が合いません: {e}")))
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.to_owned())
}

/// 中身を、DB に入れてよい形か確かめる。ホットキーは保存の形にそろえる。
///
/// # Errors
///
/// 件数・長さ・形が上限や決まりに合わなければ `InvalidInput`。
pub fn validate(mut file: BackupFile) -> Result<ValidBackup, AppError> {
    if file.app_version.len() > MAX_APP_VERSION_LEN {
        return Err(invalid("バックアップの版の表記が長すぎます"));
    }
    check_timestamp(&file.created_at)?;
    let max_favorites = usize::try_from(prefs::MAX_FAVORITES).unwrap_or(usize::MAX);
    if file.favorites.len() > max_favorites {
        return Err(invalid(&format!(
            "お気に入りが多すぎます（{max_favorites} 件まで）"
        )));
    }
    if file.history.len() > prefs::HISTORY_LIMIT {
        return Err(invalid(&format!(
            "履歴が多すぎます（{} 件まで）",
            prefs::HISTORY_LIMIT
        )));
    }
    for entry in &file.favorites {
        check_target(&entry.target)?;
        check_timestamp(&entry.created_at)?;
    }
    for entry in &file.history {
        check_target(&entry.target)?;
        check_timestamp(&entry.viewed_at)?;
    }

    let mut kept = Map::new();
    let mut skipped_settings = Vec::new();
    for (key, value) in std::mem::take(&mut file.settings) {
        if !managed_keys().any(|known| known == key) {
            // 新しい版で足した設定など。知らないキーを DB に入れない
            skipped_settings.push(key);
            continue;
        }
        settings::check_value(&value)?;
        let value = if key == hotkey::SETTINGS_KEY {
            hotkey::sanitize_setting(&value)
        } else {
            value
        };
        kept.insert(key, value);
    }
    file.settings = kept;
    Ok(ValidBackup {
        file,
        skipped_settings,
    })
}

fn check_target(target: &BackupTarget) -> Result<(), AppError> {
    let parts: Vec<(&str, usize)> = match target {
        BackupTarget::Section { source, anchor } => {
            vec![(source, MAX_SOURCE_LEN), (anchor, MAX_ANCHOR_LEN)]
        }
        BackupTarget::Document { source } => vec![(source, MAX_SOURCE_LEN)],
        BackupTarget::Flow { flow_id } => vec![(flow_id, prefs::MAX_ID_LEN)],
        BackupTarget::Quickref { row_id } => vec![(row_id, prefs::MAX_ID_LEN)],
    };
    for (text, max) in parts {
        if text.trim().is_empty() || text.len() > max || text.chars().any(char::is_control) {
            return Err(invalid("お気に入り・履歴の対象の形が合いません"));
        }
    }
    Ok(())
}

/// 日時は画面にそのまま出すので、アプリが書く形（UTC の ISO 8601）だけを受ける。
fn check_timestamp(text: &str) -> Result<(), AppError> {
    if text.len() <= MAX_TIMESTAMP_LEN && is_utc_timestamp(text) {
        Ok(())
    } else {
        Err(invalid("バックアップの日時の形が合いません"))
    }
}

/// `YYYY-MM-DDTHH:MM:SS[.fff…]Z` で、実在する日付と時刻か。
/// 日時のクレートを増やさずに確かめる（形だけを見ると、`2026-99-99T99:99:99Z` が通ってしまう）。
fn is_utc_timestamp(text: &str) -> bool {
    /// `text[range]` が数字だけなら、その数。
    fn number(text: &str, range: std::ops::Range<usize>) -> Option<u32> {
        let digits = text.get(range)?;
        if digits.bytes().all(|b| b.is_ascii_digit()) {
            digits.parse().ok()
        } else {
            None
        }
    }

    let Some(body) = text.strip_suffix('Z') else {
        return false;
    };
    let (main, fraction) = body
        .split_once('.')
        .map_or((body, None), |(m, f)| (m, Some(f)));
    let separators = main.len() == 19
        && [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':')]
            .into_iter()
            .all(|(at, expected)| main.as_bytes().get(at) == Some(&expected));
    if !separators {
        return false;
    }
    if fraction.is_some_and(|f| f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(main, 0..4),
        number(main, 5..7),
        number(main, 8..10),
        number(main, 11..13),
        number(main, 14..16),
        number(main, 17..19),
    ) else {
        return false;
    };
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day) && hour < 24 && minute < 60 && second < 60
}

/// 原稿の場所から、今の DB の文書の id を引く。
#[derive(Default)]
struct IdBySource(HashMap<String, Option<String>>);

impl IdBySource {
    fn get(&mut self, conn: &Connection, source: &str) -> Result<Option<String>, AppError> {
        if let Some(known) = self.0.get(source) {
            return Ok(known.clone());
        }
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM documents WHERE source_path = ?1",
                [source],
                |r| r.get(0),
            )
            .optional()?;
        self.0.insert(source.to_owned(), id.clone());
        Ok(id)
    }

    /// DB に入れる (`target_type`, `target_id`)。原稿が今の DB に無ければ None。
    fn pref_row(
        &mut self,
        conn: &Connection,
        target: &BackupTarget,
    ) -> Result<Option<(&'static str, String)>, AppError> {
        Ok(match target {
            BackupTarget::Section { source, anchor } => self
                .get(conn, source)?
                .map(|id| (prefs::SECTION, format!("{id}#{anchor}"))),
            BackupTarget::Document { source } => {
                self.get(conn, source)?.map(|id| (prefs::DOCUMENT, id))
            }
            BackupTarget::Flow { flow_id } => Some((prefs::FLOW, flow_id.clone())),
            BackupTarget::Quickref { row_id } => Some((prefs::QUICKREF, row_id.clone())),
        })
    }
}

/// 復元したら何件入り、何件入らないかを、DB を変えずに数える（確認の画面に出す）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn preview(conn: &Connection, backup: &ValidBackup) -> Result<RestoreCounts, AppError> {
    let mut ids = IdBySource::default();
    let mut counts = RestoreCounts::default();
    // お気に入りは対象ごとに 1 つしか持てない。同じ対象が 2 回書かれたファイルでも、実際に入る数を出す
    let mut favorites = HashSet::new();
    for entry in &backup.file.favorites {
        match ids.pref_row(conn, &entry.target)? {
            Some(row) => {
                favorites.insert(row);
            }
            None => counts.unresolved_favorites += 1,
        }
    }
    counts.favorites = favorites.len();
    for entry in &backup.file.history {
        if ids.pref_row(conn, &entry.target)?.is_some() {
            counts.history += 1;
        } else {
            counts.unresolved_history += 1;
        }
    }
    Ok(counts)
}

/// お気に入り・履歴・設定を、バックアップの中身で置き換える。途中で失敗したら何も変えない。
///
/// # Errors
///
/// DB の書き込みに失敗した場合。
pub fn apply(conn: &mut Connection, backup: &ValidBackup) -> Result<RestoreCounts, AppError> {
    let tx = conn.transaction()?;
    let mut ids = IdBySource::default();
    let mut counts = RestoreCounts::default();

    tx.execute("DELETE FROM favorites", [])?;
    for entry in &backup.file.favorites {
        match ids.pref_row(&tx, &entry.target)? {
            Some((kind, id)) => {
                // 同じ対象が 2 回書かれたファイルでも止めない（主キーで 1 つになる）
                counts.favorites += tx.execute(
                    "INSERT OR IGNORE INTO favorites (target_type, target_id, created_at) VALUES (?1, ?2, ?3)",
                    (kind, &id, &entry.created_at),
                )?;
            }
            None => counts.unresolved_favorites += 1,
        }
    }

    tx.execute("DELETE FROM history", [])?;
    for entry in &backup.file.history {
        match ids.pref_row(&tx, &entry.target)? {
            Some((kind, id)) => {
                counts.history += tx.execute(
                    "INSERT INTO history (target_type, target_id, viewed_at) VALUES (?1, ?2, ?3)",
                    (kind, &id, &entry.viewed_at),
                )?;
            }
            None => counts.unresolved_history += 1,
        }
    }

    // バックアップに無い設定は既定に戻す（置き換え）。このアプリが知らないキーの行には触らない
    for key in managed_keys() {
        tx.execute("DELETE FROM settings WHERE key = ?1", [key])?;
    }
    for (key, value) in &backup.file.settings {
        settings::set(&tx, key, value)?;
    }
    tx.commit()?;
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::db::fixtures::{bleeding, cpr};
    use crate::db::triage::fixtures::flow;
    use crate::db::{docs, test_conn, triage};
    use crate::model::PrefTarget;

    fn seed(conn: &mut Connection) -> (String, String) {
        let bleeding_id = docs::upsert(conn, &bleeding()).expect("保存できる");
        let cpr_id = docs::upsert(conn, &cpr()).expect("保存できる");
        triage::upsert(conn, &flow("first-contact", "負傷者への最初の対応", ""))
            .expect("保存できる");
        (bleeding_id, cpr_id)
    }

    fn section(document_id: &str, anchor: &str) -> PrefTarget {
        PrefTarget::Section {
            document_id: document_id.to_owned(),
            anchor: anchor.to_owned(),
        }
    }

    fn document(document_id: &str) -> PrefTarget {
        PrefTarget::Document {
            document_id: document_id.to_owned(),
        }
    }

    fn flow_target() -> PrefTarget {
        PrefTarget::Flow {
            flow_id: "first-contact".to_owned(),
        }
    }

    /// お気に入り 3 件・履歴 3 件・設定 2 つとホットキーを入れる。
    fn fill(conn: &mut Connection, bleeding_id: &str, cpr_id: &str) {
        prefs::fav_toggle(conn, &section(bleeding_id, "bleeding-signs")).expect("入れられる");
        prefs::fav_toggle(conn, &document(cpr_id)).expect("入れられる");
        prefs::fav_toggle(conn, &flow_target()).expect("入れられる");
        prefs::history_push(conn, &document(bleeding_id)).expect("積める");
        prefs::history_push(conn, &flow_target()).expect("積める");
        prefs::history_push(conn, &document(cpr_id)).expect("積める");
        settings::set(conn, "viewer", &json!({ "theme": "dark" })).expect("保存できる");
        settings::set(conn, "mods", &json!({ "enabled": ["circulation"] })).expect("保存できる");
        settings::set(conn, "hotkeys", &json!({ "search": "Ctrl+Alt+G" })).expect("保存できる");
    }

    fn snapshot(conn: &Connection) -> ValidBackup {
        let (file, _) = export(conn, BackupKind::Manual, "0.9.0").expect("書き出せる");
        // ファイルに書いて読み直すのと同じ道を通す
        let bytes = serde_json::to_vec(&file).expect("JSON にできる");
        validate(parse(&bytes).expect("読める")).expect("検査を通る")
    }

    fn fav_targets(conn: &Connection) -> Vec<PrefTarget> {
        prefs::fav_list(conn)
            .expect("読める")
            .into_iter()
            .map(|i| i.target)
            .collect()
    }

    fn history_targets(conn: &Connection) -> Vec<PrefTarget> {
        prefs::history_list(conn, 50)
            .expect("読める")
            .into_iter()
            .map(|i| i.target)
            .collect()
    }

    #[test]
    fn export_points_documents_by_source_path() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        fill(&mut conn, &bleeding_id, &cpr_id);
        let (file, stats) = export(&conn, BackupKind::Auto, "0.9.0").expect("書き出せる");

        assert_eq!(stats.skipped, 0);
        assert_eq!(file.format, FORMAT);
        assert_eq!(file.version, VERSION);
        assert_eq!(file.kind, BackupKind::Auto);
        let text = serde_json::to_string(&file).expect("JSON にできる");
        // インストールごとに違う id を、ファイルに書かない
        assert!(!text.contains(&bleeding_id), "{text}");
        assert!(!text.contains(&cpr_id), "{text}");
        assert_eq!(
            file.favorites.iter().map(|f| &f.target).collect::<Vec<_>>(),
            vec![
                &BackupTarget::Section {
                    source: bleeding().source_path.expect("原稿の場所がある"),
                    anchor: "bleeding-signs".to_owned()
                },
                &BackupTarget::Document {
                    source: cpr().source_path.expect("原稿の場所がある")
                },
                &BackupTarget::Flow {
                    flow_id: "first-contact".to_owned()
                },
            ]
        );
        assert_eq!(
            file.settings.keys().collect::<Vec<_>>(),
            vec!["hotkeys", "mods", "viewer"]
        );
    }

    #[test]
    fn restore_brings_back_the_exported_state() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        fill(&mut conn, &bleeding_id, &cpr_id);
        let backup = snapshot(&conn);
        let favorites = fav_targets(&conn);
        let history = history_targets(&conn);

        // 書き出した後に、全部を別の状態にする
        prefs::fav_toggle(&conn, &flow_target()).expect("外せる");
        prefs::fav_toggle(&conn, &document(&bleeding_id)).expect("入れられる");
        prefs::history_push(&mut conn, &section(&cpr_id, "cpr-steps")).expect("積める");
        settings::set(&conn, "viewer", &json!({ "theme": "light" })).expect("保存できる");
        settings::set(&conn, "overlay", &json!({ "opacity": 50 })).expect("保存できる");
        settings::set(&conn, "hotkeys", &json!({ "search": "Ctrl+Alt+H" })).expect("保存できる");

        let counts = apply(&mut conn, &backup).expect("復元できる");
        assert_eq!(
            counts,
            RestoreCounts {
                favorites: 3,
                history: 3,
                unresolved_favorites: 0,
                unresolved_history: 0
            }
        );
        assert_eq!(fav_targets(&conn), favorites);
        assert_eq!(history_targets(&conn), history);
        assert_eq!(
            settings::get(&conn, "viewer").expect("読める"),
            Some(json!({ "theme": "dark" }))
        );
        // バックアップに無かった設定は、既定に戻す（置き換え）
        assert_eq!(settings::get(&conn, "overlay").expect("読める"), None);
        assert_eq!(
            hotkey::parse_config(settings::get(&conn, "hotkeys").expect("読める").as_ref())
                [&crate::model::HotkeyAction::Search],
            "Ctrl+Alt+G"
        );
    }

    #[test]
    fn restore_maps_documents_onto_another_installation() {
        let mut source = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut source);
        fill(&mut source, &bleeding_id, &cpr_id);
        let backup = snapshot(&source);

        // 入れ直した後や別の PC: 同じ原稿でも、文書の id は別の UUID になる
        let mut other = test_conn();
        let (other_bleeding, other_cpr) = seed(&mut other);
        assert_ne!(other_bleeding, bleeding_id);

        let counts = preview(&other, &backup).expect("数えられる");
        assert_eq!(
            (counts.unresolved_favorites, counts.unresolved_history),
            (0, 0)
        );
        apply(&mut other, &backup).expect("復元できる");
        assert_eq!(
            fav_targets(&other),
            vec![
                flow_target(),
                document(&other_cpr),
                section(&other_bleeding, "bleeding-signs"),
            ]
        );
        assert_eq!(
            history_targets(&other),
            vec![
                document(&other_cpr),
                flow_target(),
                document(&other_bleeding)
            ]
        );
    }

    #[test]
    fn rows_without_a_manuscript_are_counted_and_left_out() {
        let mut source = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut source);
        fill(&mut source, &bleeding_id, &cpr_id);
        let backup = snapshot(&source);

        // 原稿をまだ同期していない DB。フローの id は作者が書いたものなので、原稿が無くても入れられる
        let mut empty = test_conn();
        let expected = RestoreCounts {
            favorites: 1,
            history: 1,
            unresolved_favorites: 2,
            unresolved_history: 2,
        };
        assert_eq!(preview(&empty, &backup).expect("数えられる"), expected);
        assert_eq!(apply(&mut empty, &backup).expect("復元できる"), expected);
        let rows: i64 = empty
            .query_row("SELECT COUNT(*) FROM favorites", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(rows, 1);
    }

    #[test]
    fn export_leaves_out_rows_whose_document_is_gone() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        fill(&mut conn, &bleeding_id, &cpr_id);
        docs::delete(&mut conn, &cpr_id).expect("消せる");

        let (file, stats) = export(&conn, BackupKind::Manual, "0.9.0").expect("書き出せる");
        // お気に入りの 1 件と、履歴の 1 件が、消えた文書を指している
        assert_eq!(stats.skipped, 2);
        assert_eq!(file.favorites.len(), 2);
        assert_eq!(file.history.len(), 2);
    }

    #[test]
    fn restore_keeps_what_the_backup_does_not_cover() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        fill(&mut conn, &bleeding_id, &cpr_id);
        let backup = snapshot(&conn);

        // このアプリが知らないキー（新しい版が書いたものなど）と、負傷者の記録、同義語
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('future', '{\"a\":1}')",
            [],
        )
        .expect("書ける");
        conn.execute(
            "INSERT INTO casualties (id, name, created_at_ms) VALUES ('c1', 'A', 0)",
            [],
        )
        .expect("書ける");
        let synonyms: i64 = conn
            .query_row("SELECT COUNT(*) FROM synonym_groups", [], |r| r.get(0))
            .expect("数えられる");
        assert!(synonyms > 0);

        apply(&mut conn, &backup).expect("復元できる");
        let count =
            |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).expect("数えられる") };
        assert_eq!(
            count("SELECT COUNT(*) FROM settings WHERE key = 'future'"),
            1
        );
        assert_eq!(count("SELECT COUNT(*) FROM casualties"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM synonym_groups"), synonyms);
    }

    #[test]
    fn failed_restore_changes_nothing() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        fill(&mut conn, &bleeding_id, &cpr_id);
        let backup = snapshot(&conn);
        prefs::fav_toggle(&conn, &flow_target()).expect("外せる");
        let favorites = fav_targets(&conn);
        let history = history_targets(&conn);

        // 設定を書くところで失敗させる（お気に入りと履歴を入れ替えた後）
        conn.execute_batch(
            "CREATE TRIGGER fail_settings BEFORE INSERT ON settings
             BEGIN SELECT RAISE(ABORT, 'test'); END;",
        )
        .expect("トリガーを作れる");
        assert!(apply(&mut conn, &backup).is_err());

        assert_eq!(fav_targets(&conn), favorites);
        assert_eq!(history_targets(&conn), history);
        assert_eq!(
            settings::get(&conn, "viewer").expect("読める"),
            Some(json!({ "theme": "dark" }))
        );
    }

    fn sample() -> Value {
        json!({
            "format": FORMAT,
            "version": 1,
            "appVersion": "0.9.0",
            "dbVersion": 13,
            "createdAt": "2026-11-21T09:30:00.123Z",
            "kind": "manual",
            "favorites": [
                { "target": { "kind": "flow", "flowId": "first-contact" }, "createdAt": "2026-11-20T00:00:00.000Z" }
            ],
            "history": [
                { "target": { "kind": "quickref", "rowId": "bleeding-heavy" }, "viewedAt": "2026-11-20T00:00:00.000Z" }
            ],
            "settings": { "viewer": { "theme": "dark" } }
        })
    }

    fn check(value: &Value) -> Result<ValidBackup, AppError> {
        validate(parse(value.to_string().as_bytes())?)
    }

    fn rejected(value: &Value) -> String {
        match check(value) {
            Err(AppError::InvalidInput(message)) => message,
            other => panic!("InvalidInput で断るはず: {other:?}"),
        }
    }

    #[test]
    fn sample_file_is_accepted() {
        let backup = check(&sample()).expect("検査を通る");
        assert_eq!(backup.file().favorites.len(), 1);
        assert_eq!(backup.skipped_settings(), Vec::<String>::new());
    }

    #[test]
    fn files_that_are_not_ours_are_rejected() {
        assert!(
            matches!(parse(b"not json"), Err(AppError::InvalidInput(m)) if m.contains("JSON として読めません"))
        );
        let mut other = sample();
        other["format"] = json!("something-else");
        assert!(rejected(&other).contains("このアプリのバックアップのファイルではありません"));
        // 設定のファイルなど、たまたま JSON のもの
        assert!(rejected(&json!({ "theme": "dark" })).contains("このアプリのバックアップ"));
        assert!(rejected(&json!([1, 2, 3])).contains("このアプリのバックアップ"));
    }

    #[test]
    fn newer_or_unreadable_versions_are_rejected() {
        let mut newer = sample();
        newer["version"] = json!(VERSION + 1);
        assert!(rejected(&newer).contains("新しい版のアプリで作ったバックアップです"));
        for version in [json!(0), json!("1"), json!(null), json!(-1)] {
            let mut broken = sample();
            broken["version"] = version;
            assert!(rejected(&broken).contains("版を読めません"));
        }
    }

    #[test]
    fn unknown_fields_and_shapes_are_rejected() {
        let mut extra = sample();
        extra["synonyms"] = json!([]);
        assert!(rejected(&extra).contains("形が合いません"));

        let mut kind = sample();
        kind["favorites"][0]["target"] = json!({ "kind": "casualty", "id": "c1" });
        assert!(rejected(&kind).contains("形が合いません"));

        let mut missing = sample();
        missing
            .as_object_mut()
            .expect("オブジェクト")
            .remove("history");
        assert!(rejected(&missing).contains("形が合いません"));
    }

    #[test]
    fn oversized_input_is_rejected() {
        let bytes = vec![b' '; MAX_BACKUP_BYTES + 1];
        assert!(
            matches!(parse(&bytes), Err(AppError::InvalidInput(m)) if m.contains("大きすぎます"))
        );

        let entry = json!({ "target": { "kind": "flow", "flowId": "f" }, "createdAt": "2026-11-20T00:00:00.000Z" });
        let mut many = sample();
        many["favorites"] = Value::Array(vec![entry; 1001]);
        assert!(rejected(&many).contains("お気に入りが多すぎます"));

        let viewed = json!({ "target": { "kind": "flow", "flowId": "f" }, "viewedAt": "2026-11-20T00:00:00.000Z" });
        let mut long = sample();
        long["history"] = Value::Array(vec![viewed; prefs::HISTORY_LIMIT + 1]);
        assert!(rejected(&long).contains("履歴が多すぎます"));

        let mut big = sample();
        big["settings"]["viewer"] = json!({ "x": "a".repeat(settings::MAX_VALUE_LEN) });
        assert!(rejected(&big).contains("バイトまでです"));
    }

    #[test]
    fn bad_targets_and_timestamps_are_rejected() {
        for target in [
            json!({ "kind": "flow", "flowId": "  " }),
            json!({ "kind": "flow", "flowId": "a\nb" }),
            json!({ "kind": "document", "source": "s".repeat(MAX_SOURCE_LEN + 1) }),
            json!({ "kind": "section", "source": "bundle://manuals/a.md", "anchor": "a".repeat(MAX_ANCHOR_LEN + 1) }),
        ] {
            let mut broken = sample();
            broken["favorites"][0]["target"] = target;
            assert!(rejected(&broken).contains("対象の形が合いません"));
        }
        for at in [
            "yesterday",
            "2026-11-20 00:00:00",
            "<b>2026-11-20T00:00:00Z",
        ] {
            let mut broken = sample();
            broken["history"][0]["viewedAt"] = json!(at);
            assert!(rejected(&broken).contains("日時の形が合いません"), "{at}");
        }
    }

    #[test]
    fn timestamps_must_be_real_utc_dates() {
        for at in [
            "2026-11-21T09:30:00.123Z",
            "2026-11-21T09:30:00Z",
            "2024-02-29T23:59:59.999999Z",
            "2000-02-29T00:00:00Z",
        ] {
            assert!(is_utc_timestamp(at), "{at}");
        }
        for at in [
            "TZ",
            "",
            "2026-99-99T99:99:99Z",
            "2026-02-29T00:00:00Z",
            "2100-02-29T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-00-10T00:00:00Z",
            "2026-11-00T00:00:00Z",
            "2026-11-21T24:00:00Z",
            "2026-11-21T09:60:00Z",
            "2026-11-21T09:30:60Z",
            "2026-11-21T09:30:00.Z",
            "2026-11-21T09:30:00.12aZ",
            "2026-11-21T09:30:00+09:00",
            "2026-11-21 09:30:00Z",
            "2026-1-21T09:30:00Z",
            "+026-11-21T09:30:00Z",
            "2026-11-21T09:30:00",
            "２０２６-11-21T09:30:00Z",
        ] {
            assert!(!is_utc_timestamp(at), "{at}");
        }
        let mut broken = sample();
        broken["favorites"][0]["createdAt"] = json!("2026-99-99T99:99:99Z");
        assert!(rejected(&broken).contains("日時の形が合いません"));
    }

    #[test]
    fn preview_counts_what_restore_really_puts_in() {
        let mut value = sample();
        let favorite = value["favorites"][0].clone();
        let viewed = value["history"][0].clone();
        // 同じ対象が 2 回。お気に入りは 1 つにまとまり、履歴は開いた回数だけ入る
        value["favorites"] = json!([favorite, favorite]);
        value["history"] = json!([viewed, viewed]);
        let backup = check(&value).expect("検査を通る");
        let mut conn = test_conn();
        seed(&mut conn);

        let expected = RestoreCounts {
            favorites: 1,
            history: 2,
            unresolved_favorites: 0,
            unresolved_history: 0,
        };
        assert_eq!(preview(&conn, &backup).expect("数えられる"), expected);
        assert_eq!(apply(&mut conn, &backup).expect("復元できる"), expected);
    }

    #[test]
    fn hotkeys_never_end_up_on_the_same_key() {
        let sanitized = |hotkeys: Value| {
            let mut value = sample();
            value["settings"] = json!({ "hotkeys": hotkeys });
            check(&value).expect("検査を通る").file().settings["hotkeys"].clone()
        };
        let defaults =
            json!({ "toggle": "Ctrl+Shift+M", "search": "Ctrl+Shift+F", "triage": "Ctrl+Shift+T" });
        // 後ろの動作を既定値に戻すと、その既定値が前の動作と同じキーになる
        assert_eq!(
            sanitized(json!({ "toggle": "Ctrl+Shift+F", "search": "Ctrl+Shift+F" })),
            defaults
        );
        assert_eq!(
            sanitized(json!({ "toggle": "Ctrl+Shift+T", "triage": "Ctrl+Shift+T" })),
            defaults
        );
        // 重なりが無ければ、そのまま残す
        assert_eq!(
            sanitized(
                json!({ "toggle": "Ctrl+Shift+F", "search": "Ctrl+Shift+M", "triage": "Ctrl+Alt+T" })
            ),
            json!({ "toggle": "Ctrl+Shift+F", "search": "Ctrl+Shift+M", "triage": "Ctrl+Alt+T" })
        );
    }

    #[test]
    fn settings_are_checked_and_unknown_keys_are_skipped() {
        let mut value = sample();
        value["settings"] = json!({
            "viewer": { "theme": "dark" },
            "future": { "a": 1 },
            "hotkeys": { "toggle": "Ctrl+Alt+G", "search": "ctrl+alt+g", "triage": "A" }
        });
        let backup = check(&value).expect("検査を通る");
        assert_eq!(backup.skipped_settings(), ["future"]);
        assert!(!backup.file().settings.contains_key("future"));
        // 同じキーが付いた後ろの動作と、修飾キーの無い組み合わせは、既定に戻す
        assert_eq!(
            backup.file().settings["hotkeys"],
            json!({ "toggle": "Ctrl+Alt+G", "search": "Ctrl+Shift+F", "triage": "Ctrl+Shift+T" })
        );

        let mut not_object = sample();
        not_object["settings"]["viewer"] = json!("dark");
        assert!(rejected(&not_object).contains("オブジェクトにしてください"));
    }

    #[test]
    fn duplicate_favorites_in_a_file_become_one() {
        let mut value = sample();
        let entry = value["favorites"][0].clone();
        value["favorites"] = json!([entry, entry]);
        let backup = check(&value).expect("検査を通る");
        let mut conn = test_conn();
        seed(&mut conn);
        let counts = apply(&mut conn, &backup).expect("復元できる");
        assert_eq!(counts.favorites, 1);
    }
}
