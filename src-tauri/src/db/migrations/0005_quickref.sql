-- 症状→処置 クイック表。定義の根拠は dev-docs/reference/data-model.md §2、書き方は content-guide.md §8。
-- 同梱の content/quickref.yaml の写しで、ファイルが変われば全行を置き換える。
-- id は作者が書くスラッグ（自動採番だと全置き換えのたびに変わり、お気に入り・履歴・quickref: のリンクが切れるため）。
-- 行は数十なので、検索はフローと同じく LIKE にし、FTS の表は作らない。
CREATE TABLE quickref_rows (
  id           TEXT PRIMARY KEY,             -- スラッグ
  category     TEXT NOT NULL,
  symptom      TEXT NOT NULL,
  severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4), -- 1=軽度 2=中等度 3=重度 4=致命的
  treatment    TEXT NOT NULL,                -- 手順（JSON 配列）
  items        TEXT NOT NULL DEFAULT '[]',   -- JSON 配列
  notes        TEXT,
  links        TEXT NOT NULL DEFAULT '[]',   -- JSON 配列
  mods         TEXT NOT NULL DEFAULT '[]',   -- 表示条件: すべて有効なとき（JSON 配列）
  without_mods TEXT NOT NULL DEFAULT '[]',   -- 表示条件: すべて無効なとき（JSON 配列）
  mod_targets  TEXT NOT NULL DEFAULT '[]',   -- 検索の絞り込み用（mods。空なら ["core"]）
  mod_channel  TEXT,                         -- release|dev（ファイル全体の値の写し。NULL = 版を問わない）
  search_text  TEXT NOT NULL DEFAULT '',     -- 手順・物品・備考を改行でつないだもの（LIKE 検索用）
  order_index  INTEGER NOT NULL
);

-- 同梱ファイルの情報（1 行だけ）。行が 0 件でも変更を判定できるように行とは別に持つ。
CREATE TABLE quickref_meta (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  source_hash TEXT NOT NULL,
  mod_channel TEXT,
  verified_at TEXT,                          -- YYYY-MM-DD
  updated_at  TEXT NOT NULL
);
