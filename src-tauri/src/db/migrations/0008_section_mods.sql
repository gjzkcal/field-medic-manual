-- 節の表示条件（原稿の見出しの直後の <!-- mods: … -->）。親の見出しの条件を合わせた JSON 配列で持つ。
-- ビューアと見出しツリーは、設定「使っている MOD」に合わない節を外す。検索はこの列では絞らない。
ALTER TABLE sections ADD COLUMN mods TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sections ADD COLUMN without_mods TEXT NOT NULL DEFAULT '[]';
