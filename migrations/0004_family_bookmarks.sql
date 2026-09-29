-- 保存（ブックマーク）を家族で 1 つにし、プロフィールをなくす。
-- 既存の保存は、誰かが保存していた候補をすべて引き継ぐ。
CREATE TABLE bookmarks (
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
INSERT INTO bookmarks (item_id, created_at)
  SELECT item_id, MIN(created_at) FROM favorites GROUP BY item_id;
DROP TABLE favorites;
DROP TABLE profiles;

-- 表記を大人向けに（既定値のままなら）
UPDATE family_settings SET origin_label = '自宅' WHERE origin_label = 'じたく';
