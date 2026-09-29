-- Phase 4: 取り込み（出典と実行記録）

-- 候補ごとの出典。取り込みの照合キー（source_id + source_key）を一意にする
CREATE TABLE source_entries (
  id             TEXT PRIMARY KEY,
  item_id        TEXT REFERENCES items(id) ON DELETE RESTRICT,
  place_id       TEXT REFERENCES places(id) ON DELETE RESTRICT,
  -- config/sources.yaml の収集元 ID（親の URL 追加は parent_url）
  source_id      TEXT NOT NULL CHECK (length(source_id) > 0),
  -- 出典内で企画を識別するキー。同じ URL に複数企画がある場合も区別する
  source_key     TEXT NOT NULL CHECK (length(source_key) > 0),
  url            TEXT NOT NULL,
  fetched_at     TEXT NOT NULL,
  -- 初期判定の根拠（短い引用）・要確認事項・未定義タグの提案・画像候補（JSON）
  evidence       TEXT NOT NULL DEFAULT '[]',
  needs_review   TEXT NOT NULL DEFAULT '[]',
  suggested_tags TEXT NOT NULL DEFAULT '[]',
  image_candidates TEXT NOT NULL DEFAULT '[]',
  batch_id       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  CHECK ((item_id IS NULL) != (place_id IS NULL)),
  UNIQUE (source_id, source_key)
);
CREATE INDEX source_entries_item ON source_entries (item_id);
CREATE INDEX source_entries_url ON source_entries (url);

-- 取り込みの実行記録
CREATE TABLE import_runs (
  id             TEXT PRIMARY KEY,
  batch_id       TEXT NOT NULL,
  input_hash     TEXT NOT NULL,
  target         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
  new_count      INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  review_count   INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT NOT NULL
);
CREATE INDEX import_runs_batch ON import_runs (batch_id, started_at);
