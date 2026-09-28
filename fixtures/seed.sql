-- 架空のテスト用データ。実在の施設・人物ではない。
-- ローカル開発: pnpm db:reset:local

INSERT INTO places (id, name, address_text, latitude, longitude, position_accuracy, google_place_id, google_maps_url, initialized_at, created_at, updated_at) VALUES
  ('pl-sample-science', 'サンプル市こども科学館', 'サンプル市みどり町1-2-3', 35.6800, 139.7600, 'exact', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-park', 'サンプル森林公園', 'サンプル市もり町', 35.7000, 139.7000, 'approximate', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-gym', 'サンプルクライミングジム', NULL, NULL, NULL, 'unknown', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

INSERT INTO items (id, kind, place_id, title, child_description, rain_policy, publish_status, official_url, initialized_at, created_at, updated_at) VALUES
  -- 常設・雨OK
  ('it-science-spot', 'spot', 'pl-sample-science', 'サンプル市こども科学館', 'じっけんや けんびきょうで、ふしぎを しらべよう。', 'ok', 'published', 'https://example.com/science', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  -- 同じ会場のイベント 2 件
  ('it-science-slime', 'event', 'pl-sample-science', 'スライムづくり教室', 'ふわふわの スライムを つくって もってかえろう。', 'ok', 'published', 'https://example.com/science/events', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
  ('it-science-star', 'event', 'pl-sample-science', 'ほしぞら観察会', 'ぼうえんきょうで おつきさまを みよう。', 'not_suitable', 'published', 'https://example.com/science/events', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
  -- 雨は条件付き・位置は概略
  ('it-park-spot', 'spot', 'pl-sample-park', 'サンプル森林公園', 'ながい すべりだいと どんぐりの もり。', 'not_suitable', 'published', NULL, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z'),
  ('it-park-nature', 'event', 'pl-sample-park', 'いきもの観察ウォーク', 'もりの むしや とりを さがそう。', 'conditional', 'published', NULL, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z'),
  -- 位置不明・雨不明
  ('it-gym-spot', 'spot', 'pl-sample-gym', 'サンプルクライミングジム', 'かべを のぼって てっぺんを めざそう。', 'unknown', 'published', NULL, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  -- 会場不明のイベント・説明なし
  ('it-wood-event', 'event', NULL, '木のおもちゃづくり体験', NULL, 'unknown', 'published', 'https://example.com/events/sample-craft', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
  -- 一覧に出ないもの
  ('it-draft', 'event', NULL, '確認中のイベント', NULL, 'unknown', 'draft', NULL, NULL, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'),
  ('it-hidden', 'spot', 'pl-sample-park', '非表示にした候補', NULL, 'unknown', 'hidden', NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

INSERT INTO profiles (id, display_name, age_hint, sort_order, active, created_at, updated_at) VALUES
  ('pr-sora', 'そら', 7, 1, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pr-umi', 'うみ', 4, 2, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pr-parent', 'おうちのひと', NULL, 9, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

INSERT INTO favorites (profile_id, item_id, created_at) VALUES
  ('pr-sora', 'it-science-slime', '2026-09-10T00:00:00.000Z'),
  ('pr-umi', 'it-park-spot', '2026-09-10T00:00:00.000Z');
