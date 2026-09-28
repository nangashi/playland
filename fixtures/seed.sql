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

-- ---- Phase 2: タグ・日程・参加条件・予約・移動（架空） ----

UPDATE items SET facility_tags_status = 'assessed', experience_tags_status = 'assessed'
 WHERE id IN ('it-science-spot', 'it-science-slime', 'it-science-star', 'it-park-spot', 'it-gym-spot');

INSERT INTO item_tags (item_id, tag_id) VALUES
  ('it-science-spot', 'science_museum'),
  ('it-science-spot', 'experiment'),
  ('it-science-spot', 'microscope'),
  ('it-science-slime', 'science_museum'),
  ('it-science-slime', 'experiment'),
  ('it-science-slime', 'crafting'),
  ('it-science-star', 'science_museum'),
  ('it-science-star', 'stargazing'),
  ('it-park-spot', 'park'),
  ('it-park-spot', 'athletic'),
  ('it-park-nature', 'park'),
  ('it-park-nature', 'insects'),
  ('it-gym-spot', 'sports_facility'),
  ('it-gym-spot', 'climbing'),
  ('it-wood-event', 'woodwork');

-- 離れた 2 日の開催 / 終了済み / 開催日不明 / 時刻あり
UPDATE items SET schedule_status = 'known' WHERE id IN ('it-science-slime', 'it-science-star', 'it-wood-event');
INSERT INTO event_occurrences (id, item_id, start_date, end_date, starts_at, ends_at, precision, status) VALUES
  ('oc-slime-1', 'it-science-slime', '2026-10-10', '2026-10-10', NULL, NULL, 'date', 'scheduled'),
  ('oc-slime-2', 'it-science-slime', '2026-10-24', '2026-10-24', NULL, NULL, 'date', 'scheduled'),
  ('oc-star-1', 'it-science-star', '2026-09-20', '2026-09-20', '2026-09-20T09:00:00.000Z', '2026-09-20T11:00:00.000Z', 'datetime', 'scheduled'),
  ('oc-wood-1', 'it-wood-event', '2026-11-03', '2026-11-03', '2026-11-03T01:00:00.000Z', '2026-11-03T03:00:00.000Z', 'datetime', 'scheduled');

UPDATE items SET age_min_kind = 'value', age_min = 6, age_max_kind = 'none',
                 guardian_rule = 'not_required', sibling_rule = 'unknown',
                 eligibility_raw_text = '小学生（6歳以上）',
                 reservation_requirement = 'required', reservation_note = '先着20名。申込は開催日の前週まで',
                 price_status = 'paid', price_text = '材料費 300円',
                 recommended_age_min = 6, recommended_age_max = 10
 WHERE id = 'it-science-slime';
UPDATE items SET age_min_kind = 'none', age_max_kind = 'none', guardian_rule = 'required',
                 sibling_rule = 'allowed', eligibility_raw_text = '小学生以下は保護者同伴',
                 reservation_requirement = 'not_required', price_status = 'free'
 WHERE id = 'it-science-star';
UPDATE items SET age_min_kind = 'value', age_min = 4, age_max_kind = 'unknown',
                 eligibility_raw_text = '4歳から。身長110cm以上'
 WHERE id = 'it-gym-spot';

-- 出発地点の版 1 での、親が確認した目安
INSERT INTO travel_estimates (id, place_id, origin_version, mode, source, route_status, minutes, basis, walk_minutes, transfers, note, observed_at) VALUES
  ('te-sci-transit', 'pl-sample-science', 1, 'transit', 'manual', 'estimated', 40, 'door_to_door', 12, 1, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-sci-car', 'pl-sample-science', 1, 'car', 'manual', 'estimated', 25, 'driving_only', NULL, NULL, '駐車場は土日混雑', '2026-09-10T00:00:00.000Z'),
  ('te-park-transit', 'pl-sample-park', 1, 'transit', 'manual', 'estimated', 55, 'door_to_door', 20, 2, 'バスは1時間に2本', '2026-09-10T00:00:00.000Z'),
  ('te-park-bike', 'pl-sample-park', 1, 'bicycle', 'manual', 'estimated', 18, 'door_to_door', NULL, NULL, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-gym-bike', 'pl-sample-gym', 1, 'bicycle', 'manual', 'estimated', 21, 'door_to_door', NULL, NULL, NULL, '2026-09-10T00:00:00.000Z');

INSERT INTO place_transport_preferences (place_id, mode, visibility, note, updated_at) VALUES
  ('pl-sample-gym', 'car', 'hide', '駐車場なし', '2026-09-10T00:00:00.000Z');
