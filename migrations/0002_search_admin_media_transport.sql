-- Phase 2: 条件検索・管理編集・写真・移動
-- 不明は unknown / NULL で持ち、false・0・0分に変換しない。

-- ---------------------------------------------------------------
-- 候補の参加条件・予約・料金・タグ判定状態・日程状態
-- ---------------------------------------------------------------

-- タグは分類ごとに「未判定」と「判定済み（該当なしを含む）」を区別する
ALTER TABLE items ADD COLUMN facility_tags_status TEXT NOT NULL DEFAULT 'unassessed'
  CHECK (facility_tags_status IN ('assessed', 'unassessed'));
ALTER TABLE items ADD COLUMN experience_tags_status TEXT NOT NULL DEFAULT 'unassessed'
  CHECK (experience_tags_status IN ('assessed', 'unassessed'));

-- イベントの開催日が分かっているか。常設スポットでは使わない
ALTER TABLE items ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (schedule_status IN ('known', 'unknown'));

-- 主催者が定めた参加資格（年齢）。value=数値あり / none=制限なしと明記 / unknown=記載なし・未確認
ALTER TABLE items ADD COLUMN age_min_kind TEXT NOT NULL DEFAULT 'unknown'
  CHECK (age_min_kind IN ('value', 'none', 'unknown'));
ALTER TABLE items ADD COLUMN age_min INTEGER CHECK (age_min IS NULL OR age_min BETWEEN 0 AND 120);
ALTER TABLE items ADD COLUMN age_max_kind TEXT NOT NULL DEFAULT 'unknown'
  CHECK (age_max_kind IN ('value', 'none', 'unknown'));
ALTER TABLE items ADD COLUMN age_max INTEGER CHECK (age_max IS NULL OR age_max BETWEEN 0 AND 120);
-- 解釈できない条件も含めた原文（学年・身長・居住地など）
ALTER TABLE items ADD COLUMN eligibility_raw_text TEXT;
ALTER TABLE items ADD COLUMN guardian_rule TEXT NOT NULL DEFAULT 'unknown'
  CHECK (guardian_rule IN ('required', 'not_required', 'unknown'));
-- 未就学のきょうだいの同伴
ALTER TABLE items ADD COLUMN sibling_rule TEXT NOT NULL DEFAULT 'unknown'
  CHECK (sibling_rule IN ('allowed', 'not_allowed', 'unknown'));

-- 楽しめそうな年齢（おすすめの目安。参加資格ではない）
ALTER TABLE items ADD COLUMN recommended_age_min INTEGER
  CHECK (recommended_age_min IS NULL OR recommended_age_min BETWEEN 0 AND 120);
ALTER TABLE items ADD COLUMN recommended_age_max INTEGER
  CHECK (recommended_age_max IS NULL OR recommended_age_max BETWEEN 0 AND 120);

ALTER TABLE items ADD COLUMN reservation_requirement TEXT NOT NULL DEFAULT 'unknown'
  CHECK (reservation_requirement IN ('required', 'not_required', 'unknown'));
-- 抽選／先着・申込期間などの原文
ALTER TABLE items ADD COLUMN reservation_note TEXT;
ALTER TABLE items ADD COLUMN price_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (price_status IN ('free', 'paid', 'unknown'));
ALTER TABLE items ADD COLUMN price_text TEXT;
-- 親が内容を確認・修正した日時（初期取得日とは別）
ALTER TABLE items ADD COLUMN parent_reviewed_at TEXT;

-- ALTER TABLE では表をまたぐ CHECK を追加できないため、整合はトリガーで守る
CREATE TRIGGER items_age_consistency_insert BEFORE INSERT ON items
WHEN (NEW.age_min_kind = 'value') != (NEW.age_min IS NOT NULL)
  OR (NEW.age_max_kind = 'value') != (NEW.age_max IS NOT NULL)
  OR (NEW.age_min IS NOT NULL AND NEW.age_max IS NOT NULL AND NEW.age_min > NEW.age_max)
BEGIN
  SELECT RAISE(ABORT, 'age bounds inconsistent');
END;
CREATE TRIGGER items_age_consistency_update BEFORE UPDATE ON items
WHEN (NEW.age_min_kind = 'value') != (NEW.age_min IS NOT NULL)
  OR (NEW.age_max_kind = 'value') != (NEW.age_max IS NOT NULL)
  OR (NEW.age_min IS NOT NULL AND NEW.age_max IS NOT NULL AND NEW.age_min > NEW.age_max)
BEGIN
  SELECT RAISE(ABORT, 'age bounds inconsistent');
END;

-- ---------------------------------------------------------------
-- タグ（定義は src/domain/tags.ts。定義済み ID だけをアプリで受け付ける）
-- ---------------------------------------------------------------
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL CHECK (length(tag_id) > 0),
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX item_tags_tag ON item_tags (tag_id);

-- ---------------------------------------------------------------
-- 開催日・回。離れた開催日は別の行にする（最初から最後まで毎日とは解釈しない）
-- ---------------------------------------------------------------
CREATE TABLE event_occurrences (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date   TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- 時刻が分かる場合だけ UTC の ISO 8601。日付だけの開催を午前0時の確定時刻にしない
  starts_at  TEXT,
  ends_at    TEXT,
  precision  TEXT NOT NULL CHECK (precision IN ('date', 'datetime')),
  status     TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  CHECK (end_date >= start_date),
  CHECK (precision = 'datetime' OR (starts_at IS NULL AND ends_at IS NULL)),
  CHECK (precision = 'date' OR starts_at IS NOT NULL),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX event_occurrences_item ON event_occurrences (item_id);
CREATE INDEX event_occurrences_dates ON event_occurrences (start_date, end_date);

-- ---------------------------------------------------------------
-- 写真（本体は非公開 R2。ここは保存先とメタ情報）
-- ---------------------------------------------------------------
CREATE TABLE media (
  id           TEXT PRIMARY KEY,
  r2_key       TEXT NOT NULL UNIQUE,
  item_id      TEXT REFERENCES items(id) ON DELETE RESTRICT,
  place_id     TEXT REFERENCES places(id) ON DELETE RESTRICT,
  -- 会場の写真 / 過去の開催風景 / イメージ。実際の開催内容と区別して表示する
  kind         TEXT NOT NULL CHECK (kind IN ('venue', 'past_event', 'image')),
  source_url   TEXT,
  credit       TEXT,
  license_note TEXT,
  reviewed_by  TEXT,
  reviewed_at  TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  sha256       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  -- place と item のどちらか一方だけに紐付ける
  CHECK ((item_id IS NULL) != (place_id IS NULL))
);
CREATE INDEX media_item ON media (item_id, status, sort_order);
CREATE INDEX media_place ON media (place_id, status, sort_order);

-- ---------------------------------------------------------------
-- 家族設定（1 行だけ）。正確な自宅位置は一般の API に出さない
-- ---------------------------------------------------------------
CREATE TABLE family_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  origin_label        TEXT NOT NULL DEFAULT 'じたく',
  origin_latitude     REAL,
  origin_longitude    REAL,
  -- 出発地点を変えたら上げる。古い版の所要時間は現行の値として使わない
  origin_version      INTEGER NOT NULL DEFAULT 1 CHECK (origin_version >= 1),
  bicycle_max_minutes INTEGER NOT NULL DEFAULT 20 CHECK (bicycle_max_minutes BETWEEN 1 AND 180),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at          TEXT NOT NULL,
  CHECK ((origin_latitude IS NULL) = (origin_longitude IS NULL))
);
INSERT INTO family_settings (id, updated_at) VALUES (1, '2026-09-29T00:00:00.000Z');

-- ---------------------------------------------------------------
-- 移動手段の表示方針（行がなければ default）
-- ---------------------------------------------------------------
CREATE TABLE place_transport_preferences (
  place_id   TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL CHECK (mode IN ('transit', 'car', 'bicycle')),
  visibility TEXT NOT NULL DEFAULT 'default' CHECK (visibility IN ('default', 'show', 'hide')),
  note       TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (place_id, mode)
);

-- ---------------------------------------------------------------
-- 所要時間の目安。施設の固定属性にせず、出発地点の版・手段・取得元に紐付ける
-- 経路サービスの値（api）と親の値（manual）を別行で持ち、表示では manual を優先する
-- ---------------------------------------------------------------
CREATE TABLE travel_estimates (
  id             TEXT PRIMARY KEY,
  place_id       TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  origin_version INTEGER NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('transit', 'car', 'bicycle')),
  source         TEXT NOT NULL CHECK (source IN ('manual', 'api')),
  -- estimated=時間あり / no_route=確認した結果その手段では行けない
  route_status   TEXT NOT NULL CHECK (route_status IN ('estimated', 'no_route')),
  minutes        INTEGER CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
  -- door_to_door=自宅から入口まで / driving_only=運転時間だけ（手配・駐車後の移動は未計算）
  basis          TEXT CHECK (basis IS NULL OR basis IN ('door_to_door', 'driving_only')),
  walk_minutes   INTEGER CHECK (walk_minutes IS NULL OR walk_minutes BETWEEN 0 AND 600),
  transfers      INTEGER CHECK (transfers IS NULL OR transfers BETWEEN 0 AND 20),
  note           TEXT,
  observed_at    TEXT NOT NULL,
  CHECK ((route_status = 'estimated') = (minutes IS NOT NULL AND basis IS NOT NULL)),
  UNIQUE (place_id, origin_version, mode, source)
);

-- ---------------------------------------------------------------
-- 親の変更履歴（秘密情報や自宅座標の値は記録しない）
-- ---------------------------------------------------------------
CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type    TEXT NOT NULL CHECK (target_type IN ('item', 'place', 'settings', 'media')),
  target_id      TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('create', 'update', 'hide')),
  actor          TEXT NOT NULL,
  version_after  INTEGER,
  changed_fields TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX audit_log_target ON audit_log (target_type, target_id, id);

-- ---------------------------------------------------------------
-- 親用 PIN の試行回数制限
-- ---------------------------------------------------------------
CREATE TABLE admin_login_attempts (
  key              TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  failures         INTEGER NOT NULL DEFAULT 0
);
