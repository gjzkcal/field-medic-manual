-- 原稿の分類（front matter の category）。ライブラリと見出しツリーで、同じ分類の原稿を 1 つの見出しの下にまとめる。
-- NULL（分類のない原稿）は末尾の「その他」に並ぶ。
ALTER TABLE documents ADD COLUMN category TEXT;
