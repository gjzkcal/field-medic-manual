-- お気に入り・履歴。
-- target_id は section なら "<documentId>#<anchor>"、document は documentId、flow は flowId。
-- 対象が消えても行は残し、一覧に出さないだけにする（同じ原稿が戻れば復活させるため）。
CREATE TABLE favorites (
  target_type TEXT NOT NULL,                 -- section|document|flow
  target_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id)
);

CREATE TABLE history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  viewed_at   TEXT NOT NULL
);
CREATE INDEX ix_history_target ON history(target_type, target_id);
