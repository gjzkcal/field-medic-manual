//! 復元の確認を待っているバックアップ。
//!
//! ファイルを読んで確かめた中身をここに預かり、画面には合い言葉（token）だけを渡す。
//! 画面が「復元する」と言ってきたときにファイルを読み直すと、確かめた後に差し替えられた別の中身を入れてしまう。

use std::sync::{Mutex, PoisonError};

use crate::db::backup::ValidBackup;

#[derive(Default)]
pub struct PendingRestore(Mutex<Option<(String, ValidBackup)>>);

impl PendingRestore {
    /// 預かって、合い言葉を返す。前に預かっていたものは捨てる（確認の画面は 1 つしか出ない）。
    pub fn hold(&self, backup: ValidBackup) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        *self.lock() = Some((token.clone(), backup));
        token
    }

    /// 合い言葉が合えば取り出す。合わなければ、預かったものはそのまま残す。
    pub fn take(&self, token: &str) -> Option<ValidBackup> {
        let mut held = self.lock();
        if held.as_ref().is_some_and(|(expected, _)| expected == token) {
            held.take().map(|(_, backup)| backup)
        } else {
            None
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<(String, ValidBackup)>> {
        // 中身は置き換えるだけなので、ほかのスレッドが途中で落ちていても壊れた状態にはならない
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::backup::{self, export};
    use crate::db::test_conn;
    use crate::model::BackupKind;

    fn sample() -> ValidBackup {
        let (file, _) = export(&test_conn(), BackupKind::Manual, "0.9.0").expect("書き出せる");
        backup::validate(file).expect("検査を通る")
    }

    #[test]
    fn backup_is_given_once_and_only_for_its_token() {
        let pending = PendingRestore::default();
        assert_eq!(pending.take("anything"), None);

        let token = pending.hold(sample());
        assert_eq!(pending.take("wrong"), None);
        assert_eq!(pending.take(""), None);
        assert!(pending.take(&token).is_some());
        // 同じ合い言葉で 2 回は復元できない
        assert_eq!(pending.take(&token), None);
    }

    #[test]
    fn newer_confirmation_replaces_the_older_one() {
        let pending = PendingRestore::default();
        let first = pending.hold(sample());
        let second = pending.hold(sample());
        assert_ne!(first, second);
        assert_eq!(pending.take(&first), None);
        assert!(pending.take(&second).is_some());
    }
}
