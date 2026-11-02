//! 負傷者の記録。操作は `CasualtyOp` で 1 件ずつ受け、ここで中身と上限を確かめてから書く。
//! Web 版の同じ検査は `src/web/casualty-storage.ts`。上限を変えるときは両方を直す。

use rusqlite::{Connection, params};
use uuid::Uuid;

use crate::error::AppError;
use crate::model::{Casualty, CasualtyEntry, CasualtyOp, CasualtyRecord};

/// 同時に看る人数として十分で、記録が際限なく伸びない数
const MAX_CASUALTIES: i64 = 20;
const MAX_RECORDS_PER_CASUALTY: i64 = 100;
const MAX_NAME_CHARS: usize = 40;
const MAX_NOTE_CHARS: usize = 100;
/// 画面が渡す id は Rust が作った UUID なので、これより長いものは不正な値とみなす
const MAX_ID_LEN: usize = 64;

/// 全員の記録を、足した順に返す。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn list(conn: &Connection) -> Result<Vec<Casualty>, AppError> {
    let mut people = conn.prepare(
        "SELECT id, name, created_at_ms, in_pain FROM casualties ORDER BY created_at_ms, rowid",
    )?;
    let mut records = conn.prepare(
        "SELECT id, at_ms, entry FROM casualty_records WHERE casualty_id = ?1 ORDER BY at_ms, rowid",
    )?;
    let rows = people
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<Vec<(String, String, i64, bool)>, _>>()?;
    let mut casualties = Vec::with_capacity(rows.len());
    for (id, name, created_at_ms, in_pain) in rows {
        let rows = records
            .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<(String, i64, String)>, _>>()?;
        let records = rows
            .into_iter()
            .map(|(id, at_ms, entry)| {
                Ok(CasualtyRecord {
                    id,
                    at_ms,
                    entry: serde_json::from_str(&entry)
                        .map_err(|_| AppError::Internal("記録を読めません".to_owned()))?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        casualties.push(Casualty {
            id,
            name,
            created_at_ms,
            in_pain,
            records,
        });
    }
    Ok(casualties)
}

/// 操作を確かめて書き、全員の記録を返す。
///
/// # Errors
///
/// 中身が不正か上限を超えていれば `InvalidInput`、対象がなければ `NotFound`。
/// 文面に名前とメモを入れない（検査のエラーはログに書かれるため）。
pub fn apply(conn: &Connection, op: &CasualtyOp, now_ms: i64) -> Result<Vec<Casualty>, AppError> {
    match op {
        CasualtyOp::AddCasualty { name } => add_casualty(conn, name, now_ms)?,
        CasualtyOp::RemoveCasualty { casualty_id } => {
            check_id(casualty_id)?;
            conn.execute("DELETE FROM casualties WHERE id = ?1", [casualty_id])?;
        }
        CasualtyOp::ClearAll => clear_all(conn)?,
        CasualtyOp::AddRecord { casualty_id, entry } => {
            add_record(conn, casualty_id, entry, now_ms)?;
        }
        CasualtyOp::RemoveRecord {
            casualty_id,
            record_id,
        } => {
            check_id(casualty_id)?;
            check_id(record_id)?;
            conn.execute(
                "DELETE FROM casualty_records WHERE id = ?1 AND casualty_id = ?2",
                [record_id, casualty_id],
            )?;
        }
        CasualtyOp::SetPain {
            casualty_id,
            in_pain,
        } => {
            check_id(casualty_id)?;
            let changed = conn.execute(
                "UPDATE casualties SET in_pain = ?1 WHERE id = ?2",
                params![in_pain, casualty_id],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound("負傷者が見つかりません".to_owned()));
            }
        }
    }
    list(conn)
}

/// 全員の記録を消す。記録は外部キーで一緒に消える。
///
/// # Errors
///
/// DB の書き込みに失敗した場合。
pub fn clear_all(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM casualties", [])?;
    Ok(())
}

fn add_casualty(conn: &Connection, name: &str, now_ms: i64) -> Result<(), AppError> {
    check_text("名前", name, MAX_NAME_CHARS)?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM casualties", [], |r| r.get(0))?;
    if count >= MAX_CASUALTIES {
        return Err(AppError::InvalidInput(format!(
            "負傷者は {MAX_CASUALTIES} 人までです"
        )));
    }
    conn.execute(
        "INSERT INTO casualties (id, name, created_at_ms) VALUES (?1, ?2, ?3)",
        params![Uuid::new_v4().to_string(), name.trim(), now_ms],
    )?;
    Ok(())
}

fn add_record(
    conn: &Connection,
    casualty_id: &str,
    entry: &CasualtyEntry,
    now_ms: i64,
) -> Result<(), AppError> {
    check_id(casualty_id)?;
    if let CasualtyEntry::Note { text } = entry {
        check_text("メモ", text, MAX_NOTE_CHARS)?;
    }
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM casualties WHERE id = ?1",
        [casualty_id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::NotFound("負傷者が見つかりません".to_owned()));
    }
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM casualty_records WHERE casualty_id = ?1",
        [casualty_id],
        |r| r.get(0),
    )?;
    if count >= MAX_RECORDS_PER_CASUALTY {
        return Err(AppError::InvalidInput(format!(
            "記録は 1 人 {MAX_RECORDS_PER_CASUALTY} 件までです"
        )));
    }
    let entry = serde_json::to_string(entry)
        .map_err(|_| AppError::Internal("記録を保存できません".to_owned()))?;
    conn.execute(
        "INSERT INTO casualty_records (id, casualty_id, at_ms, entry) VALUES (?1, ?2, ?3, ?4)",
        params![Uuid::new_v4().to_string(), casualty_id, now_ms, entry],
    )?;
    Ok(())
}

fn check_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(AppError::InvalidInput("id が不正です".to_owned()));
    }
    Ok(())
}

/// バイト数ではなく文字数で数える（画面の入力欄の上限と同じ数え方にするため）。
fn check_text(name: &str, value: &str, max_chars: usize) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidInput(format!("{name}が空です")));
    }
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{name}は {max_chars} 文字までです"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::db::test_conn;
    use crate::model::{CasualtyDrug, TourniquetSite};

    const NOW: i64 = 1_793_000_000_000;

    fn add_person(conn: &Connection, name: &str) -> String {
        let op = CasualtyOp::AddCasualty {
            name: name.to_owned(),
        };
        apply(conn, &op, NOW)
            .expect("足せる")
            .last()
            .expect("1 人はいる")
            .id
            .clone()
    }

    fn drug(casualty_id: &str) -> CasualtyOp {
        CasualtyOp::AddRecord {
            casualty_id: casualty_id.to_owned(),
            entry: CasualtyEntry::Drug {
                drug: CasualtyDrug::Epinephrine,
            },
        }
    }

    #[test]
    fn records_keep_order_and_survive_listing() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        apply(&conn, &drug(&id), NOW + 1000).expect("書ける");
        let op = CasualtyOp::AddRecord {
            casualty_id: id.clone(),
            entry: CasualtyEntry::TourniquetOn {
                site: TourniquetSite::LeftLeg,
            },
        };
        let all = apply(&conn, &op, NOW + 2000).expect("書ける");
        let records = &all[0].records;
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].at_ms, NOW + 1000);
        assert_eq!(
            records[1].entry,
            CasualtyEntry::TourniquetOn {
                site: TourniquetSite::LeftLeg
            }
        );
        assert_eq!(list(&conn).expect("読める"), all);
    }

    #[test]
    fn removing_a_record_keeps_the_others() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        apply(&conn, &drug(&id), NOW).expect("書ける");
        let all = apply(&conn, &drug(&id), NOW + 1).expect("書ける");
        let first = all[0].records[0].id.clone();
        let op = CasualtyOp::RemoveRecord {
            casualty_id: id,
            record_id: first.clone(),
        };
        let all = apply(&conn, &op, NOW).expect("消せる");
        assert_eq!(all[0].records.len(), 1);
        assert_ne!(all[0].records[0].id, first);
    }

    #[test]
    fn removing_a_casualty_removes_their_records() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        apply(&conn, &drug(&id), NOW).expect("書ける");
        let op = CasualtyOp::RemoveCasualty { casualty_id: id };
        assert_eq!(apply(&conn, &op, NOW).expect("消せる"), Vec::new());
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM casualty_records", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(left, 0);
    }

    #[test]
    fn clear_all_empties_both_tables() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        add_person(&conn, "負傷者 2");
        apply(&conn, &drug(&id), NOW).expect("書ける");
        clear_all(&conn).expect("消せる");
        assert_eq!(list(&conn).expect("読める"), Vec::new());
    }

    #[test]
    fn pain_defaults_to_on_and_can_be_switched() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        assert!(list(&conn).expect("読める")[0].in_pain);
        let op = CasualtyOp::SetPain {
            casualty_id: id,
            in_pain: false,
        };
        assert!(!apply(&conn, &op, NOW).expect("変えられる")[0].in_pain);
        let missing = CasualtyOp::SetPain {
            casualty_id: "none".to_owned(),
            in_pain: true,
        };
        assert!(matches!(
            apply(&conn, &missing, NOW),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn rejects_more_casualties_than_the_limit() {
        let conn = test_conn();
        for i in 0..MAX_CASUALTIES {
            add_person(&conn, &format!("負傷者 {i}"));
        }
        let op = CasualtyOp::AddCasualty {
            name: "多すぎる".to_owned(),
        };
        assert!(matches!(
            apply(&conn, &op, NOW),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn rejects_more_records_than_the_limit() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        for _ in 0..MAX_RECORDS_PER_CASUALTY {
            apply(&conn, &drug(&id), NOW).expect("書ける");
        }
        assert!(matches!(
            apply(&conn, &drug(&id), NOW),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn rejects_record_for_missing_casualty() {
        let conn = test_conn();
        assert!(matches!(
            apply(&conn, &drug("none"), NOW),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn limits_count_characters_not_bytes() {
        let conn = test_conn();
        let id = add_person(&conn, &"あ".repeat(MAX_NAME_CHARS));
        let note = |text: String| CasualtyOp::AddRecord {
            casualty_id: id.clone(),
            entry: CasualtyEntry::Note { text },
        };
        assert!(apply(&conn, &note("あ".repeat(MAX_NOTE_CHARS)), NOW).is_ok());
        assert!(apply(&conn, &note("あ".repeat(MAX_NOTE_CHARS + 1)), NOW).is_err());
    }

    /// 同じ不正な操作の一覧を、Web 版のテスト（casualty-storage.test.ts）も読む
    #[test]
    fn shared_invalid_ops_are_rejected() {
        let fixture: Value =
            serde_json::from_str(include_str!("testdata/casualty-invalid-ops.json"))
                .expect("JSON として読める");
        let cases = fixture.as_array().expect("配列");
        assert_ne!(cases.len(), 0);
        for case in cases {
            let conn = test_conn();
            let id = add_person(&conn, "負傷者 1");
            let text = case.to_string().replace("$CASUALTY", &id);
            let rejected = match serde_json::from_str::<CasualtyOp>(&text) {
                Ok(op) => apply(&conn, &op, NOW).is_err(),
                Err(_) => true,
            };
            assert!(rejected, "通ってしまった: {text}");
        }
    }

    #[test]
    fn error_messages_do_not_contain_user_text() {
        let conn = test_conn();
        let id = add_person(&conn, "負傷者 1");
        let secret = "ひみつ".repeat(MAX_NOTE_CHARS);
        let op = CasualtyOp::AddRecord {
            casualty_id: id,
            entry: CasualtyEntry::Note {
                text: secret.clone(),
            },
        };
        let error = apply(&conn, &op, NOW).expect_err("長すぎる");
        assert!(!error.to_string().contains("ひみつ"));
    }
}
