import type { FavoriteRecord, ItemRecord, PlaceRecord, ProfileRecord } from "../domain/model";

/** D1 へのアクセスはすべてここに集約し、必ずパラメーター化する */

const ITEM_COLUMNS = `id, kind, place_id, title, child_description, rain_policy,
  publish_status, official_url, created_at`;

export async function listPublishedItems(db: D1Database): Promise<ItemRecord[]> {
  const { results } = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE publish_status = 'published'`)
    .all<ItemRecord>();
  return results;
}

export async function getPublishedItem(db: D1Database, id: string): Promise<ItemRecord | null> {
  return db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ? AND publish_status = 'published'`)
    .bind(id)
    .first<ItemRecord>();
}

// D1 のバインド数上限（100）を超えないよう分割して問い合わせる
const IN_CHUNK = 50;

export async function getPlaces(db: D1Database, ids: string[]): Promise<Map<string, PlaceRecord>> {
  const unique = [...new Set(ids)];
  const places = new Map<string, PlaceRecord>();
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const { results } = await db
      .prepare(
        `SELECT id, name, address_text, latitude, longitude, position_accuracy,
                google_place_id, google_maps_url
           FROM places WHERE id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all<PlaceRecord>();
    for (const p of results) places.set(p.id, p);
  }
  return places;
}

const FAVORITE_SELECT = `SELECT f.profile_id, f.item_id, f.created_at
  FROM favorites f JOIN profiles p ON p.id = f.profile_id AND p.active = 1`;

/** 家族全体のお気に入り。家族規模の件数を前提に一括で読む */
export async function listFavorites(db: D1Database): Promise<FavoriteRecord[]> {
  const { results } = await db.prepare(FAVORITE_SELECT).all<FavoriteRecord>();
  return results;
}

export async function listFavoritesForItem(db: D1Database, itemId: string): Promise<FavoriteRecord[]> {
  const { results } = await db
    .prepare(`${FAVORITE_SELECT} WHERE f.item_id = ?`)
    .bind(itemId)
    .all<FavoriteRecord>();
  return results;
}

export async function listActiveProfiles(db: D1Database): Promise<ProfileRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, display_name, age_hint, sort_order FROM profiles
        WHERE active = 1 ORDER BY sort_order, id`,
    )
    .all<ProfileRecord>();
  return results;
}

export async function isActiveProfile(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS ok FROM profiles WHERE id = ? AND active = 1`).bind(id).first();
  return row !== null;
}

/** 何度呼んでも 1 件だけ残る（冪等） */
export async function addFavorite(db: D1Database, profileId: string, itemId: string, now: string) {
  await db
    .prepare(
      `INSERT INTO favorites (profile_id, item_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (profile_id, item_id) DO NOTHING`,
    )
    .bind(profileId, itemId, now)
    .run();
}

/** 存在しなくても成功扱い（冪等） */
export async function removeFavorite(db: D1Database, profileId: string, itemId: string) {
  await db
    .prepare(`DELETE FROM favorites WHERE profile_id = ? AND item_id = ?`)
    .bind(profileId, itemId)
    .run();
}
