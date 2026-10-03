-- 原稿を書くときに読んだ ACE-Anvil のソースのコミット（front matter の ace_commit）。版の番号だけでは、どのソースを読んだかが分からないため。
-- NULL はソースを読まずに書いた原稿か、書き忘れ。
ALTER TABLE documents ADD COLUMN ace_commit TEXT;
