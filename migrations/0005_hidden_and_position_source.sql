-- 家族で「興味なし」にした候補（検索で「興味なしも表示」を選んだときだけ出す）
CREATE TABLE hidden_items (
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

-- 座標の出どころ。親が指定・変更したものは自動取得で上書きしない
--   parent=親が指定 / source_page=元ページに記載 / geocoder=住所検索の結果
ALTER TABLE places ADD COLUMN position_source TEXT
  CHECK (position_source IS NULL OR position_source IN ('parent', 'source_page', 'geocoder'));
-- 住所検索で一致した住所など（どの結果を使ったかの記録）
ALTER TABLE places ADD COLUMN position_note TEXT;
