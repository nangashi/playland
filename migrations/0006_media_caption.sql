-- 写真に写っているものの説明（拡大表示で出す）
ALTER TABLE media ADD COLUMN caption TEXT CHECK (caption IS NULL OR length(caption) <= 200);
