use rusqlite::Connection;

use crate::error::AppError;

/// 適用順に並べる。一度リリースしたものは書き換えず、変更は新しいファイルを足す（利用者の DB に再適用されないため）。
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_init.sql"),
    include_str!("migrations/0002_seed_synonyms.sql"),
];

/// `PRAGMA user_version` を「適用済みのマイグレーションの数」として使い、未適用分を順に適用する。
pub fn migrate(conn: &mut Connection) -> Result<(), AppError> {
    let applied: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let applied = usize::try_from(applied)
        .map_err(|_| AppError::Internal(format!("user_version が不正です: {applied}")))?;
    if applied > MIGRATIONS.len() {
        return Err(AppError::Internal(format!(
            "DB がこのアプリより新しい版で作られています（user_version = {applied}）"
        )));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(applied) {
        // 途中で失敗したマイグレーションを半端に残さないよう、1 本ずつトランザクションで囲む
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        let version = i64::try_from(index + 1)
            .map_err(|_| AppError::Internal("マイグレーションの数が多すぎます".to_owned()))?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn user_version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |r| r.get(0))
            .expect("user_version を読める")
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .expect("sqlite_master を読める")
            == 1
    }

    #[test]
    fn applies_all_migrations() {
        let conn = test_conn();
        assert_eq!(user_version(&conn), 2);
        for table in [
            "documents",
            "sections",
            "fts_sections",
            "assets",
            "document_assets",
            "settings",
            "tags",
            "document_tags",
            "section_tags",
            "synonym_groups",
            "synonyms",
        ] {
            assert!(table_exists(&conn, table), "{table} がない");
        }
        // 後のステップで作る表は、まだない
        assert!(!table_exists(&conn, "quickref_rows"));
        assert!(!table_exists(&conn, "triage_flows"));
    }

    #[test]
    fn rerun_is_noop_and_keeps_seed_edits() {
        let mut conn = test_conn();
        // ユーザーが初期値を消した状態を作る
        conn.execute("DELETE FROM synonym_groups WHERE id = 1", [])
            .expect("削除できる");
        migrate(&mut conn).expect("再実行できる");
        assert_eq!(user_version(&conn), 2);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM synonym_groups WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .expect("数えられる");
        assert_eq!(count, 0, "消した初期値が復活している");
    }

    #[test]
    fn rejects_newer_database() {
        let mut conn = test_conn();
        conn.pragma_update(None, "user_version", 99)
            .expect("user_version を書ける");
        assert!(migrate(&mut conn).is_err());
    }

    #[test]
    fn fts5_trigram_is_available() {
        let conn = test_conn();
        let version: String = conn
            .query_row("SELECT sqlite_version()", [], |r| r.get(0))
            .expect("版を読める");
        // trigram トークナイザは 3.34 以上が必要
        let mut parts = version.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
        let (major, minor) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
        assert!((major, minor) >= (3, 34), "SQLite {version} は古い");
    }
}
