-- 保存の並び順（ランキング）。小さいほど上位。家族で 1 つを共有する
ALTER TABLE bookmarks ADD COLUMN rank INTEGER NOT NULL DEFAULT 0;
-- 既存の保存は、保存した順（同時刻は ID 順）に並べる
UPDATE bookmarks SET rank = (
  SELECT COUNT(*) FROM bookmarks AS b
   WHERE b.created_at < bookmarks.created_at
      OR (b.created_at = bookmarks.created_at AND b.item_id <= bookmarks.item_id)
);
