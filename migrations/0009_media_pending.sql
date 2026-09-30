-- 取り込みで集めた写真は「採用待ち（pending）」で保存し、親が承認待ちの画面で採用したものだけを表示する。
-- SQLite は CHECK 制約を変更できないため、表を作り直す（media を参照する表はない）
CREATE TABLE media_new (
  id           TEXT PRIMARY KEY,
  r2_key       TEXT NOT NULL UNIQUE,
  item_id      TEXT REFERENCES items(id) ON DELETE RESTRICT,
  place_id     TEXT REFERENCES places(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL CHECK (kind IN ('venue', 'past_event', 'image')),
  source_url   TEXT,
  credit       TEXT,
  license_note TEXT,
  reviewed_by  TEXT,
  reviewed_at  TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  sha256       TEXT NOT NULL,
  -- active=表示 / hidden=親が非表示にした / pending=取り込みで集めて親の採用待ち（表示しない）
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'pending')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  caption      TEXT CHECK (caption IS NULL OR length(caption) <= 200),
  CHECK ((item_id IS NULL) != (place_id IS NULL))
);
INSERT INTO media_new (id, r2_key, item_id, place_id, kind, source_url, credit, license_note, reviewed_by, reviewed_at,
                       content_type, byte_size, sha256, status, sort_order, created_at, caption)
  SELECT id, r2_key, item_id, place_id, kind, source_url, credit, license_note, reviewed_by, reviewed_at,
         content_type, byte_size, sha256, status, sort_order, created_at, caption
    FROM media;
DROP TABLE media;
ALTER TABLE media_new RENAME TO media;
CREATE INDEX media_item ON media (item_id, status, sort_order);
CREATE INDEX media_place ON media (place_id, status, sort_order);
