-- 負傷者の記録。時刻は Unix ミリ秒で持ち、画面が今の時刻との差でタイマーを出す（裏に回しても閉じてもずれないように）。
CREATE TABLE casualties (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

-- entry は記録の中身の JSON。Rust の CasualtyEntry で検査してから書く
CREATE TABLE casualty_records (
  id          TEXT PRIMARY KEY,
  casualty_id TEXT NOT NULL REFERENCES casualties(id) ON DELETE CASCADE,
  at_ms       INTEGER NOT NULL,
  entry       TEXT NOT NULL
);

CREATE INDEX idx_casualty_records_casualty ON casualty_records(casualty_id, at_ms);
