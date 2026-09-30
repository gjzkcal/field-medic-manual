-- 原稿の並び順（front matter の order）。ライブラリと見出しツリーをこの順に並べる。
-- 列名は SQL の予約語 order を避ける。NULL（番号のない原稿）はタイトル順で後ろに並ぶ。
ALTER TABLE documents ADD COLUMN sort_order INTEGER;
