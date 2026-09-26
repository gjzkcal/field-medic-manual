//! お気に入りと履歴。対象は `PrefTarget` で受け、DB では (`target_type`, `target_id`) の文字列で持つ。
//! 対象（文書・節・フロー）が同期で消えても行は消さず、一覧に出さないだけにする（同じ原稿が戻れば復活させるため）。

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
use crate::model::{PrefItem, PrefTarget};

/// 履歴に残す件数。「最近見たもの」に出すには十分で、表が際限なく伸びない数
pub const HISTORY_LIMIT: usize = 200;
const MAX_ID_LEN: usize = 512;

/// お気に入りに入れる / 外す。入れたら true、外したら false。
///
/// # Errors
///
/// 対象の id が空か長すぎれば `InvalidInput`。
pub fn fav_toggle(conn: &Connection, target: &PrefTarget) -> Result<bool, AppError> {
    let (kind, id) = encode(target)?;
    let removed = conn.execute(
        "DELETE FROM favorites WHERE target_type = ?1 AND target_id = ?2",
        (kind, &id),
    )?;
    if removed > 0 {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO favorites (target_type, target_id, created_at) VALUES (?1, ?2, ?3)",
        (kind, &id, super::now(conn)?),
    )?;
    Ok(true)
}

/// お気に入りを新しい順に返す。対象が消えたものは返さない。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn fav_list(conn: &Connection) -> Result<Vec<PrefItem>, AppError> {
    // 同じミリ秒に入れたものも入れた順に並ぶよう、rowid でも並べる
    let mut stmt = conn.prepare(
        "SELECT target_type, target_id, created_at FROM favorites
         ORDER BY created_at DESC, rowid DESC",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<(String, String, String)>, _>>()?;
    let mut items = Vec::new();
    for (kind, id, at) in rows {
        if let Some(item) = resolve(conn, &kind, &id, at)? {
            items.push(item);
        }
    }
    Ok(items)
}

/// 開いたものを履歴に積む。直前と同じ対象なら時刻だけ更新し、古いものは `HISTORY_LIMIT` 件に刈る。
///
/// # Errors
///
/// 対象の id が空か長すぎれば `InvalidInput`。
pub fn history_push(conn: &mut Connection, target: &PrefTarget) -> Result<(), AppError> {
    let (kind, id) = encode(target)?;
    let tx = conn.transaction()?;
    let now = super::now(&tx)?;
    let last: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT id, target_type, target_id FROM history ORDER BY id DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    match last {
        // 同じ文書を開き直すたびに行が増えると、「最近見たもの」がすぐ同じもので埋まるため
        Some((row_id, last_kind, last_id)) if last_kind == kind && last_id == id => {
            tx.execute(
                "UPDATE history SET viewed_at = ?1 WHERE id = ?2",
                params![now, row_id],
            )?;
        }
        _ => {
            tx.execute(
                "INSERT INTO history (target_type, target_id, viewed_at) VALUES (?1, ?2, ?3)",
                (kind, &id, &now),
            )?;
        }
    }
    let limit = i64::try_from(HISTORY_LIMIT)
        .map_err(|_| AppError::Internal("履歴の上限が大きすぎます".to_owned()))?;
    tx.execute(
        "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?1)",
        [limit],
    )?;
    tx.commit()?;
    Ok(())
}

/// 最近開いたものを新しい順に、対象ごとに 1 件ずつ最大 `limit` 件返す。対象が消えたものは返さない。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn history_list(conn: &Connection, limit: usize) -> Result<Vec<PrefItem>, AppError> {
    // 最後に開いた順は id で決める（viewed_at は同じミリ秒になりうるため）
    let mut stmt = conn.prepare(
        "SELECT h.target_type, h.target_id, h.viewed_at FROM history h
         JOIN (SELECT MAX(id) AS last_id FROM history GROUP BY target_type, target_id) l
           ON h.id = l.last_id
         ORDER BY h.id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<(String, String, String)>, _>>()?;
    let mut items = Vec::new();
    for (kind, id, at) in rows {
        if items.len() >= limit {
            break;
        }
        if let Some(item) = resolve(conn, &kind, &id, at)? {
            items.push(item);
        }
    }
    Ok(items)
}

const SECTION: &str = "section";
const DOCUMENT: &str = "document";
const FLOW: &str = "flow";

/// DB に保存する (`target_type`, `target_id`)。文書の id は UUID で `#` を含まないので、節は最初の `#` で分けられる。
fn encode(target: &PrefTarget) -> Result<(&'static str, String), AppError> {
    let (kind, parts): (&'static str, Vec<&str>) = match target {
        PrefTarget::Section {
            document_id,
            anchor,
        } => (SECTION, vec![document_id, anchor]),
        PrefTarget::Document { document_id } => (DOCUMENT, vec![document_id]),
        PrefTarget::Flow { flow_id } => (FLOW, vec![flow_id]),
    };
    if parts.iter().any(|p| p.trim().is_empty()) {
        return Err(AppError::InvalidInput(format!(
            "お気に入り・履歴の対象が空です: {target:?}"
        )));
    }
    let id = parts.join("#");
    if id.len() > MAX_ID_LEN {
        return Err(AppError::InvalidInput(format!(
            "お気に入り・履歴の対象の id は {MAX_ID_LEN} バイトまでです"
        )));
    }
    Ok((kind, id))
}

/// 対象を今の DB で引き、題名を付ける。見つからなければ None。
fn resolve(
    conn: &Connection,
    kind: &str,
    id: &str,
    at: String,
) -> Result<Option<PrefItem>, AppError> {
    let found = match kind {
        SECTION => {
            let Some((document_id, anchor)) = id.split_once('#') else {
                return Ok(None);
            };
            conn.query_row(
                "SELECT s.title, d.title FROM sections s JOIN documents d ON d.id = s.document_id
                 WHERE s.document_id = ?1 AND s.anchor = ?2",
                (document_id, anchor),
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
            .map(|(title, doc_title)| {
                let target = PrefTarget::Section {
                    document_id: document_id.to_owned(),
                    anchor: anchor.to_owned(),
                };
                // 見出しの前の導入部は題名が空なので、文書の題名で出す
                if title.trim().is_empty() {
                    (target, doc_title, None)
                } else {
                    (target, title, Some(doc_title))
                }
            })
        }
        DOCUMENT => conn
            .query_row("SELECT title FROM documents WHERE id = ?1", [id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .map(|title| {
                let target = PrefTarget::Document {
                    document_id: id.to_owned(),
                };
                (target, title, None)
            }),
        FLOW => conn
            .query_row("SELECT title FROM triage_flows WHERE id = ?1", [id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .map(|title| {
                let target = PrefTarget::Flow {
                    flow_id: id.to_owned(),
                };
                (target, title, None)
            }),
        // 後の版で種類を足した DB を古い版で開いたときなど。知らない種類は出さない
        _ => None,
    };
    Ok(found.map(|(target, title, context)| PrefItem {
        target,
        title,
        context,
        at,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{bleeding, cpr};
    use crate::db::test_conn;
    use crate::db::triage::fixtures::flow;
    use crate::db::{docs, triage};

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

    fn flow_target(flow_id: &str) -> PrefTarget {
        PrefTarget::Flow {
            flow_id: flow_id.to_owned(),
        }
    }

    fn targets(items: &[PrefItem]) -> Vec<PrefTarget> {
        items.iter().map(|i| i.target.clone()).collect()
    }

    #[test]
    fn fav_toggle_adds_then_removes() {
        let mut conn = test_conn();
        let (bleeding_id, _) = seed(&mut conn);
        assert!(fav_toggle(&conn, &document(&bleeding_id)).expect("入れられる"));
        assert_eq!(
            targets(&fav_list(&conn).expect("読める")),
            vec![document(&bleeding_id)]
        );
        assert!(!fav_toggle(&conn, &document(&bleeding_id)).expect("外せる"));
        assert!(fav_list(&conn).expect("読める").is_empty());
    }

    #[test]
    fn fav_list_resolves_titles_newest_first() {
        let mut conn = test_conn();
        let (bleeding_id, _) = seed(&mut conn);
        fav_toggle(&conn, &section(&bleeding_id, "bleeding-signs")).expect("入れられる");
        fav_toggle(&conn, &flow_target("first-contact")).expect("入れられる");
        let items = fav_list(&conn).expect("読める");
        assert_eq!(items.len(), 2);
        let [latest, oldest] = items.as_slice() else {
            panic!("2 件のはず");
        };
        assert_eq!(latest.target, flow_target("first-contact"));
        assert_eq!(latest.title, "負傷者への最初の対応");
        assert_eq!(latest.context, None);
        assert_eq!(oldest.target, section(&bleeding_id, "bleeding-signs"));
        assert_eq!(oldest.title, "出血の見分け方");
        assert_eq!(oldest.context.as_deref(), Some("出血"));
    }

    #[test]
    fn missing_targets_are_hidden_but_kept() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        fav_toggle(&conn, &document(&cpr_id)).expect("入れられる");
        fav_toggle(&conn, &section(&bleeding_id, "no-such-anchor")).expect("入れられる");
        fav_toggle(&conn, &flow_target("no-such-flow")).expect("入れられる");
        docs::delete(&mut conn, &cpr_id).expect("消せる");
        assert!(fav_list(&conn).expect("読める").is_empty());
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM favorites", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(rows, 3, "消えた対象の行も残す");
    }

    #[test]
    fn rejects_empty_or_long_ids() {
        let mut conn = test_conn();
        for target in [
            document(""),
            section("doc", ""),
            section("", "a"),
            flow_target("  "),
            document(&"x".repeat(MAX_ID_LEN + 1)),
        ] {
            assert!(
                matches!(fav_toggle(&conn, &target), Err(AppError::InvalidInput(_))),
                "{target:?}"
            );
            assert!(
                matches!(
                    history_push(&mut conn, &target),
                    Err(AppError::InvalidInput(_))
                ),
                "{target:?}"
            );
        }
    }

    #[test]
    fn history_merges_repeats_and_lists_each_target_once() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        history_push(&mut conn, &document(&bleeding_id)).expect("積める");
        history_push(&mut conn, &document(&bleeding_id)).expect("積める");
        history_push(&mut conn, &flow_target("first-contact")).expect("積める");
        history_push(&mut conn, &document(&cpr_id)).expect("積める");
        history_push(&mut conn, &document(&bleeding_id)).expect("積める");
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(rows, 4, "続けて同じものを開いても 1 行");
        assert_eq!(
            targets(&history_list(&conn, 10).expect("読める")),
            vec![
                document(&bleeding_id),
                document(&cpr_id),
                flow_target("first-contact"),
            ]
        );
        assert_eq!(history_list(&conn, 2).expect("読める").len(), 2);
    }

    #[test]
    fn history_is_trimmed_to_limit() {
        let mut conn = test_conn();
        let (bleeding_id, cpr_id) = seed(&mut conn);
        for i in 0..=HISTORY_LIMIT {
            let id = if i % 2 == 0 { &bleeding_id } else { &cpr_id };
            history_push(&mut conn, &document(id)).expect("積める");
        }
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(usize::try_from(rows).expect("正の数"), HISTORY_LIMIT);
        assert_eq!(
            targets(&history_list(&conn, 1).expect("読める")),
            vec![document(&bleeding_id)],
            "最後に積んだものが先頭"
        );
    }

    #[test]
    fn history_skips_missing_targets_without_shrinking_limit() {
        let mut conn = test_conn();
        let (bleeding_id, _) = seed(&mut conn);
        history_push(&mut conn, &document(&bleeding_id)).expect("積める");
        history_push(&mut conn, &flow_target("gone")).expect("積める");
        assert_eq!(
            targets(&history_list(&conn, 1).expect("読める")),
            vec![document(&bleeding_id)],
            "消えた対象を飛ばして limit 件まで埋める"
        );
    }
}
