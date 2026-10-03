-- 原稿を書くときに処理を確かめたゲーム本体の版（front matter の game_version）。本体の更新で数値が変わったときに、どの版で確かめたかを示すため。
-- NULL は本体を確かめずに書いた原稿か、書き忘れ。
ALTER TABLE documents ADD COLUMN game_version TEXT;
