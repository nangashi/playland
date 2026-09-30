/**
 * データの書き出し・書き込み（ローカル → 本番の移行、バックアップ、復元で共通）。
 * スキーマはマイグレーションで作る前提で、ここでは行データと写真ファイルだけを扱う。
 * 親が PIN を入力した試行記録（admin_login_attempts）とマイグレーション管理表は対象外。
 */

/** 外部キーの順に並べたデータ表 */
export const DATA_TABLES = [
  "places",
  "items",
  "item_tags",
  "event_occurrences",
  "bookmarks",
  "hidden_items",
  "place_transport_preferences",
  "travel_estimates",
  "media",
  "source_entries",
  "import_runs",
  "audit_log",
] as const;
export type DataTable = (typeof DATA_TABLES)[number];

type Row = Record<string, unknown>;

export interface Snapshot {
  schema_version: 1;
  created_at: string;
  tables: Record<DataTable, Row[]>;
  /** 家族設定（自宅の座標を含むので、バックアップの扱いに注意） */
  family_settings: Row;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export async function dumpDatabase(db: D1Database, now = new Date()): Promise<Snapshot> {
  const tables = {} as Record<DataTable, Row[]>;
  for (const table of DATA_TABLES) {
    tables[table] = (await db.prepare(`SELECT * FROM ${table}`).all<Row>()).results;
  }
  const settings = await db.prepare(`SELECT * FROM family_settings WHERE id = 1`).first<Row>();
  if (!settings) throw new Error("family_settings がありません（マイグレーション未適用？）");
  return { schema_version: 1, created_at: now.toISOString(), tables, family_settings: settings };
}

export async function countRows(db: D1Database): Promise<Record<DataTable, number>> {
  const counts = {} as Record<DataTable, number>;
  for (const table of DATA_TABLES) {
    counts[table] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
  }
  return counts;
}

/** 書き込み先が空であることを確かめる（既存のデータを上書き・混在させない） */
export async function assertEmpty(db: D1Database) {
  const counts = await countRows(db);
  const used = Object.entries(counts).filter(([, n]) => n > 0);
  if (used.length > 0) {
    throw new Error(`書き込み先にデータがあります（${used.map(([t, n]) => `${t}: ${n}`).join(", ")}）。空の DB にだけ書き込めます`);
  }
}

const CHUNK = 40;

/** 空の DB に行データを書き込む。表ごとに分割した batch（各 batch は 1 トランザクション） */
export async function loadDatabase(db: D1Database, snapshot: Snapshot): Promise<Record<DataTable, number>> {
  await assertEmpty(db);
  for (const table of DATA_TABLES) {
    const rows = snapshot.tables[table] ?? [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const stmts = rows.slice(i, i + CHUNK).map((row) => {
        const cols = Object.keys(row);
        if (!cols.every((c) => IDENTIFIER.test(c))) throw new Error(`不正な列名: ${table}`);
        return db
          .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
          .bind(...cols.map((c) => row[c] ?? null));
      });
      await db.batch(stmts);
    }
  }
  const s = snapshot.family_settings;
  const cols = Object.keys(s).filter((c) => c !== "id" && IDENTIFIER.test(c));
  await db
    .prepare(`UPDATE family_settings SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = 1`)
    .bind(...cols.map((c) => s[c] ?? null))
    .run();

  // 書き込めたかを件数で確かめる
  const counts = await countRows(db);
  for (const table of DATA_TABLES) {
    if (counts[table] !== (snapshot.tables[table]?.length ?? 0)) {
      throw new Error(`${table} の件数が一致しません（期待 ${snapshot.tables[table]?.length ?? 0}、実際 ${counts[table]}）`);
    }
  }
  return counts;
}

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string | null;
}

/** media 表が参照する写真ファイルを複製する。既にあるものは中身が同じならそのまま */
export async function copyMediaObjects(
  keys: readonly string[],
  get: (key: string) => Promise<StoredObject | null>,
  bucket: R2Bucket,
  onProgress?: (key: string, result: "copied" | "exists" | "missing") => void,
): Promise<{ copied: number; exists: number; missing: string[] }> {
  let copied = 0;
  let exists = 0;
  const missing: string[] = [];
  for (const key of keys) {
    const source = await get(key);
    if (!source) {
      missing.push(key);
      onProgress?.(key, "missing");
      continue;
    }
    const head = await bucket.head(key);
    if (head && head.size === source.bytes.byteLength) {
      exists++;
      onProgress?.(key, "exists");
      continue;
    }
    await bucket.put(key, source.bytes, source.contentType ? { httpMetadata: { contentType: source.contentType } } : undefined);
    copied++;
    onProgress?.(key, "copied");
  }
  return { copied, exists, missing };
}

export function mediaKeys(snapshot: Snapshot): string[] {
  return snapshot.tables.media.map((m) => String(m.r2_key));
}
