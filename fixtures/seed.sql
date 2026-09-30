-- 架空のテスト用データ。実在の施設・人物ではない。
-- ローカル開発: pnpm db:reset:local
-- イベント（開催日のある候補）は次のフェーズで扱うため、常設スポットだけを入れる。

INSERT INTO places (id, name, address_text, latitude, longitude, position_accuracy, google_place_id, google_maps_url, initialized_at, created_at, updated_at) VALUES
  ('pl-sample-science', 'サンプル市こども科学館', 'サンプル市みどり町1-2-3', 35.6800, 139.7600, 'exact', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-park', 'サンプル森林公園', 'サンプル市もり町', 35.7000, 139.7000, 'approximate', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-gym', 'サンプルクライミングジム', NULL, NULL, NULL, 'unknown', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-aquarium', 'サンプル湾水族館', 'サンプル市みなと町5', 35.6500, 139.7800, 'exact', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-woodshop', 'サンプル木工房', 'サンプル市きのした2-8', 35.6900, 139.7300, 'exact', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-kids', 'サンプル市みなみ児童館', 'サンプル市みなみ町3-1', 35.6700, 139.7100, 'exact', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('pl-sample-farm', 'サンプルふれあい牧場', NULL, NULL, NULL, 'unknown', NULL, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

INSERT INTO items (id, kind, place_id, title, child_description, rain_policy, publish_status, official_url, initialized_at, created_at, updated_at) VALUES
  ('it-science-spot', 'spot', 'pl-sample-science', 'サンプル市こども科学館', '実験や顕微鏡で、身近な不思議を調べられる科学館。', 'ok', 'published', 'https://example.com/science', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('it-park-spot', 'spot', 'pl-sample-park', 'サンプル森林公園', '長いすべり台とどんぐりの森がある広い公園。', 'not_suitable', 'published', NULL, '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
  -- 位置不明・雨不明
  ('it-gym-spot', 'spot', 'pl-sample-gym', 'サンプルクライミングジム', '子ども向けの壁があるボルダリングジム。', 'unknown', 'published', NULL, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
  ('it-aquarium-spot', 'spot', 'pl-sample-aquarium', 'サンプル湾水族館', 'タッチプールで海の生きものにさわれる水族館。', 'ok', 'published', 'https://example.com/aquarium', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z'),
  ('it-woodshop-spot', 'spot', 'pl-sample-woodshop', 'サンプル木工房', '予約制で、親子で木のおもちゃを作れる工房。', 'ok', 'published', 'https://example.com/woodshop', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z'),
  ('it-kids-spot', 'spot', 'pl-sample-kids', 'サンプル市みなみ児童館', '工作コーナーと体育室があり、雨の日も遊べる。', 'ok', 'published', NULL, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  -- 説明・写真・位置なし
  ('it-farm-spot', 'spot', 'pl-sample-farm', 'サンプルふれあい牧場', NULL, 'conditional', 'published', NULL, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
  -- 一覧に出ないもの
  ('it-draft', 'spot', 'pl-sample-park', '確認中の候補', NULL, 'unknown', 'draft', NULL, NULL, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'),
  ('it-hidden', 'spot', 'pl-sample-park', '非表示にした候補', NULL, 'unknown', 'hidden', NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

-- 家族で共有する保存
INSERT INTO bookmarks (item_id, created_at, rank) VALUES
  ('it-science-spot', '2026-09-10T00:00:00.000Z', 1),
  ('it-park-spot', '2026-09-10T00:00:00.000Z', 2);

-- タグ（判定済み。牧場は体験タグが未判定）
UPDATE items SET facility_tags_status = 'assessed', experience_tags_status = 'assessed'
 WHERE id IN ('it-science-spot', 'it-park-spot', 'it-gym-spot', 'it-aquarium-spot', 'it-woodshop-spot', 'it-kids-spot');
UPDATE items SET facility_tags_status = 'assessed' WHERE id = 'it-farm-spot';

INSERT INTO item_tags (item_id, tag_id) VALUES
  ('it-science-spot', 'science_museum'),
  ('it-science-spot', 'experiment'),
  ('it-science-spot', 'microscope'),
  ('it-park-spot', 'park'),
  ('it-park-spot', 'athletic'),
  ('it-park-spot', 'insects'),
  ('it-gym-spot', 'sports_facility'),
  ('it-gym-spot', 'climbing'),
  ('it-aquarium-spot', 'aquarium'),
  ('it-aquarium-spot', 'aquatic_life'),
  ('it-woodshop-spot', 'workshop_studio'),
  ('it-woodshop-spot', 'woodwork'),
  ('it-kids-spot', 'childrens_center'),
  ('it-kids-spot', 'crafting'),
  ('it-kids-spot', 'ball_sports'),
  ('it-farm-spot', 'farm');

-- 参加条件・予約・料金
UPDATE items SET age_min_kind = 'value', age_min = 4, age_max_kind = 'unknown',
                 eligibility_raw_text = '4歳から。身長110cm以上'
 WHERE id = 'it-gym-spot';
UPDATE items SET age_min_kind = 'value', age_min = 6, age_max_kind = 'none',
                 guardian_rule = 'required', sibling_rule = 'not_allowed',
                 eligibility_raw_text = '6歳以上（保護者同伴）。未就学児の見学は不可',
                 reservation_requirement = 'required', reservation_note = '前日までにWeb予約',
                 price_status = 'paid', price_text = '1組 2,000円（材料費込み）',
                 recommended_age_min = 6, recommended_age_max = 12
 WHERE id = 'it-woodshop-spot';
UPDATE items SET age_min_kind = 'none', age_max_kind = 'value', age_max = 18,
                 guardian_rule = 'not_required', sibling_rule = 'allowed',
                 eligibility_raw_text = '0〜18歳（未就学児は保護者同伴）',
                 reservation_requirement = 'not_required', price_status = 'free'
 WHERE id = 'it-kids-spot';
UPDATE items SET age_min_kind = 'none', age_max_kind = 'none', guardian_rule = 'not_required',
                 sibling_rule = 'allowed', reservation_requirement = 'not_required',
                 price_status = 'paid', price_text = '大人 1,800円／小学生 900円／幼児 400円'
 WHERE id = 'it-aquarium-spot';

-- 出発地点の版 1 での、親が確認した目安
INSERT INTO travel_estimates (id, place_id, origin_version, mode, source, route_status, minutes, basis, walk_minutes, transfers, note, observed_at) VALUES
  ('te-sci-transit', 'pl-sample-science', 1, 'transit', 'manual', 'estimated', 40, 'door_to_door', 12, 1, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-sci-car', 'pl-sample-science', 1, 'car', 'manual', 'estimated', 25, 'driving_only', NULL, NULL, '駐車場は土日混雑', '2026-09-10T00:00:00.000Z'),
  ('te-park-transit', 'pl-sample-park', 1, 'transit', 'manual', 'estimated', 55, 'door_to_door', 20, 2, 'バスは1時間に2本', '2026-09-10T00:00:00.000Z'),
  ('te-park-bike', 'pl-sample-park', 1, 'bicycle', 'manual', 'estimated', 18, 'door_to_door', NULL, NULL, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-gym-bike', 'pl-sample-gym', 1, 'bicycle', 'manual', 'estimated', 21, 'door_to_door', NULL, NULL, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-aq-transit', 'pl-sample-aquarium', 1, 'transit', 'manual', 'estimated', 35, 'door_to_door', 8, 1, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-kids-bike', 'pl-sample-kids', 1, 'bicycle', 'manual', 'estimated', 12, 'door_to_door', NULL, NULL, NULL, '2026-09-10T00:00:00.000Z'),
  ('te-kids-transit', 'pl-sample-kids', 1, 'transit', 'manual', 'estimated', 25, 'door_to_door', 10, 0, NULL, '2026-09-10T00:00:00.000Z');

INSERT INTO place_transport_preferences (place_id, mode, visibility, note, updated_at) VALUES
  ('pl-sample-gym', 'car', 'hide', '駐車場なし', '2026-09-10T00:00:00.000Z');
