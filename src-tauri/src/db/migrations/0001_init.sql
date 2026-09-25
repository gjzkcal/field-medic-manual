-- 初期スキーマ。定義の根拠は dev-docs/reference/data-model.md §2。
-- クイック表・トリアージ・お気に入り・履歴は後のステップで別のマイグレーションとして足す。

-- アセット（画像、PDF 原本）。documents から参照されるので先に作る
CREATE TABLE assets (
  id        TEXT PRIMARY KEY,                -- sha256（小文字 16 進）
  mime      TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rel_path  TEXT NOT NULL,                   -- assets/<sha256>.<ext>
  size      INTEGER NOT NULL
);

-- ドキュメント（取り込み単位）
CREATE TABLE documents (
  id                TEXT PRIMARY KEY,        -- UUID v4
  title             TEXT NOT NULL,
  source_type       TEXT NOT NULL,           -- markdown|text|html|docx|pdf|url
  source_path       TEXT,                    -- 元のファイルパス、または URL
  source_hash       TEXT NOT NULL,           -- sha256（再取り込みの判定に使う）
  original_asset_id TEXT REFERENCES assets(id),
  mod_target        TEXT,                    -- core|hitzones|circulation|breathing|defibrillation|ai|general
  mod_channel       TEXT,                    -- release|dev（NULL = 版を問わない / 不明）
  mod_version       TEXT,                    -- Workshop の表記（例: 1.4.3 / 1.5.36）
  verified_at       TEXT,                    -- YYYY-MM-DD
  created_at        TEXT NOT NULL,           -- 同じ source_path で取り込み直しても引き継ぐ
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_documents_source ON documents(source_path) WHERE source_path IS NOT NULL;

-- 見出し単位のセクション（閲覧と検索の単位）
CREATE TABLE sections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  level       INTEGER NOT NULL,              -- 0 = 見出し前の導入部、1〜6
  title       TEXT NOT NULL,
  anchor      TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  html        TEXT NOT NULL,                 -- 無害化済み
  plain_text  TEXT NOT NULL,
  keywords    TEXT NOT NULL DEFAULT '',      -- section_tags の写し。全文索引に載せるために持つ
  page        INTEGER
);
CREATE INDEX ix_sections_doc ON sections(document_id, order_index);

-- 全文検索（external content 方式）。trigram なので日本語を分かち書きせずに部分一致で引ける
CREATE VIRTUAL TABLE fts_sections USING fts5(
  title, keywords, plain_text,
  content='sections', content_rowid='id',
  tokenize='trigram'
);

-- external content の FTS は自動で追従しないため、トリガーで索引を同期する（FTS5 公式ドキュメントの例どおり）
CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO fts_sections(rowid, title, keywords, plain_text)
  VALUES (new.id, new.title, new.keywords, new.plain_text);
END;
CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO fts_sections(fts_sections, rowid, title, keywords, plain_text)
  VALUES ('delete', old.id, old.title, old.keywords, old.plain_text);
END;
CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO fts_sections(fts_sections, rowid, title, keywords, plain_text)
  VALUES ('delete', old.id, old.title, old.keywords, old.plain_text);
  INSERT INTO fts_sections(rowid, title, keywords, plain_text)
  VALUES (new.id, new.title, new.keywords, new.plain_text);
END;

CREATE TABLE document_assets (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES assets(id),
  PRIMARY KEY (document_id, asset_id)
);

-- タグ（ドキュメントとセクションで共通の語彙）
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);
CREATE TABLE section_tags (
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (section_id, tag_id)
);

-- 同義語辞書（1 グループ = 同じ意味の語の集まり）
CREATE TABLE synonym_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note       TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE synonyms (
  group_id INTEGER NOT NULL REFERENCES synonym_groups(id) ON DELETE CASCADE,
  term     TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (group_id, term)
);
CREATE INDEX ix_synonyms_term ON synonyms(term);

-- 設定（キーと値）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- JSON
);
