-- トリアージフロー。定義の根拠は dev-docs/reference/data-model.md §2、フローの形は triage-format.md。
-- 一覧と絞り込みに使う値は JSON から写して列に持つ（Rust がフローの形を解釈せずに済むようにするため）。
CREATE TABLE triage_flows (
  id          TEXT PRIMARY KEY,              -- スラッグ
  title       TEXT NOT NULL,
  description TEXT,
  mod_targets TEXT NOT NULL DEFAULT '[]',    -- JSON 配列（core|circulation|...）
  mod_channel TEXT,                          -- release|dev（NULL = 版を問わない）
  verified_at TEXT,                          -- YYYY-MM-DD
  json        TEXT NOT NULL,                 -- フロー全体（TS が zod で読み直す）
  search_text TEXT NOT NULL DEFAULT '',      -- ノードの文などを改行でつないだもの（LIKE 検索用）
  source_hash TEXT NOT NULL,                 -- 同梱ファイルの sha256（変わったフローだけ入れ直すため）
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);
