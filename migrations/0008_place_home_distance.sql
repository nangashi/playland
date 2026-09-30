-- 自宅から場所までの直線距離（km）。日帰り・旅行の判定に使う
-- 場所の登録・座標の変更・自宅の変更のときにアプリで計算して保存する。座標がなければ NULL
ALTER TABLE places ADD COLUMN home_distance_km REAL CHECK (home_distance_km IS NULL OR home_distance_km >= 0);
