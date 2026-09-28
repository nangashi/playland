-- Phase 1: 場所・候補・プロフィール・お気に入りの最小モデル
-- 時刻は UTC の ISO 8601 文字列（例: 2026-09-28T00:00:00.000Z）で保存する。

-- 地理的な場所（施設・会場・地点）
CREATE TABLE places (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL CHECK (length(name) > 0),
  address_text      TEXT,
  latitude          REAL,
  longitude         REAL,
  position_accuracy TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (position_accuracy IN ('exact', 'approximate', 'unknown')),
  google_place_id   TEXT,
  google_maps_url   TEXT,
  initialized_at    TEXT,
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- 緯度経度は両方あるか両方ないか。範囲外を許さない
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
  -- 座標がないのに精度だけ exact / approximate にしない
  CHECK (latitude IS NOT NULL OR position_accuracy = 'unknown')
);

-- 一覧に載り、保存できる対象（常設スポット／イベント）
CREATE TABLE items (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('spot', 'event')),
  place_id          TEXT REFERENCES places(id) ON DELETE RESTRICT,
  title             TEXT NOT NULL CHECK (length(title) > 0),
  child_description TEXT,
  rain_policy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (rain_policy IN ('ok', 'conditional', 'not_suitable', 'unknown')),
  publish_status    TEXT NOT NULL DEFAULT 'draft'
                    CHECK (publish_status IN ('draft', 'published', 'hidden')),
  official_url      TEXT,
  initialized_at    TEXT,
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- 常設スポットは場所そのものなので会場必須。イベントは会場不明を許容する
  CHECK (kind = 'event' OR place_id IS NOT NULL)
);
CREATE INDEX items_status_kind ON items (publish_status, kind);
CREATE INDEX items_place ON items (place_id);
CREATE INDEX items_created ON items (created_at DESC, id);

-- 家族内のプロフィール。認可には使わない
CREATE TABLE profiles (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) > 0),
  age_hint     INTEGER CHECK (age_hint IS NULL OR age_hint BETWEEN 0 AND 120),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 「行きたい」。候補のコピーではなく item への参照
CREATE TABLE favorites (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, item_id)
);
CREATE INDEX favorites_item ON favorites (item_id);
