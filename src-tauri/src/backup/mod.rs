//! バックアップのファイルの扱い（置き場所、1 日 1 回の自動、保存先を選ぶダイアログ、復元の確認の預かり）。
//! 中身を作る・確かめる・DB に入れる部分は `db::backup` にある。

pub mod dialog;
pub mod pending;
pub mod schedule;
pub mod store;
