-- 同義語辞書の初期値。用語の言い換え（表記ゆれ・英語名）だけを入れ、処置の内容には触れない。
-- マイグレーションで 1 回だけ入れるのは、ユーザーが消したり直したりした語を起動のたびに復活させないため。
-- 出典: dev-docs/reference/content-guide.md §4（用語の統一）と ace-medical-notes.md（物品・状態の英語名）

INSERT INTO synonym_groups (id, note, updated_at) VALUES
  (1,  '止血帯',           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2,  'エピネフリン',     strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3,  '心停止',           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (4,  '意識喪失',         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (5,  'CPR',              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (6,  '出血',             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (7,  'モルヒネ',         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (8,  '炭酸アンモニウム', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (9,  '気胸',             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (10, '緊張性気胸',       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (11, '気道閉塞',         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (12, 'チェストシール',   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (13, 'NCD キット',       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (14, 'ナロキソン',       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (15, 'メディカルキット', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (16, '包帯',             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO synonyms (group_id, term) VALUES
  (1,  '止血帯'), (1, 'ターニケット'), (1, 'TQ'), (1, 'Tourniquet'),
  (2,  'エピネフリン'), (2, 'アドレナリン'), (2, 'エピ'), (2, 'Epinephrine'),
  (3,  '心停止'), (3, '心肺停止'), (3, 'CA'), (3, 'Cardiac arrest'),
  (4,  '意識喪失'), (4, '気絶'), (4, 'ダウン'), (4, 'Unconscious'),
  (5,  'CPR'), (5, '心肺蘇生'), (5, '心肺蘇生法'),
  (6,  '出血'), (6, 'Bleeding'),
  (7,  'モルヒネ'), (7, 'Morphine'),
  (8,  '炭酸アンモニウム'), (8, 'Ammonium carbonate'),
  (9,  '気胸'), (9, 'Pneumothorax'),
  (10, '緊張性気胸'), (10, 'Tension pneumothorax'),
  (11, '気道閉塞'), (11, 'Airway obstruction'),
  (12, 'チェストシール'), (12, 'Chest seal'),
  (13, 'NCDキット'), (13, 'NCD kit'),
  (14, 'ナロキソン'), (14, 'Naloxone'),
  (15, 'メディカルキット'), (15, 'Medical kit'),
  (16, '包帯'), (16, 'Bandage');
