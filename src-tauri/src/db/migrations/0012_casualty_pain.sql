-- 負傷者ごとの「痛み・気胸あり」。過量投与の本数の計算に使う。痛みのある負傷者が多いので既定はあり（1）
ALTER TABLE casualties ADD COLUMN in_pain INTEGER NOT NULL DEFAULT 1;
