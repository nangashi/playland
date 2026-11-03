-- 候補名の読み（ひらがな）。管理画面の文字列検索で、表記ゆれのある名前を読みでも探せるようにする。
-- 既存の候補は NULL のまま（enrich で埋め戻す）
ALTER TABLE items ADD COLUMN title_reading TEXT
  CHECK (title_reading IS NULL OR length(title_reading) BETWEEN 1 AND 200);
