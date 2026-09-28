import type {
  FamilySettingsRecord,
  FavoriteRecord,
  ItemRecord,
  ItemTagRecord,
  MediaRecord,
  OccurrenceRecord,
  PlaceRecord,
  ProfileRecord,
  TransportPreferenceRecord,
  TravelEstimateRecord,
} from "../domain/model";

/**
 * D1 の読み取りはここに集約し、必ずパラメーター化する。
 * 家族規模の件数を前提に、検索用のデータは一括で読み、絞り込みは domain の純粋関数で行う。
 */

export const ITEM_COLUMNS = `id, kind, place_id, title, child_description, rain_policy,
  publish_status, official_url, facility_tags_status, experience_tags_status, schedule_status,
  age_min_kind, age_min, age_max_kind, age_max, eligibility_raw_text, guardian_rule, sibling_rule,
  recommended_age_min, recommended_age_max, reservation_requirement, reservation_note,
  price_status, price_text, initialized_at, parent_reviewed_at, version, created_at, updated_at`;

const PLACE_COLUMNS = `id, name, address_text, latitude, longitude, position_accuracy,
  google_place_id, google_maps_url, version`;

const MEDIA_COLUMNS = `id, r2_key, item_id, place_id, kind, source_url, credit, license_note,
  content_type, byte_size, status, sort_order, created_at`;

export async function listPublishedItems(db: D1Database): Promise<ItemRecord[]> {
  const { results } = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE publish_status = 'published'`)
    .all<ItemRecord>();
  return results;
}

export async function getItem(db: D1Database, id: string): Promise<ItemRecord | null> {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).bind(id).first<ItemRecord>();
}

export async function getPublishedItem(db: D1Database, id: string): Promise<ItemRecord | null> {
  const item = await getItem(db, id);
  return item?.publish_status === "published" ? item : null;
}

export async function listItemTags(db: D1Database, itemId?: string): Promise<ItemTagRecord[]> {
  const stmt = itemId
    ? db.prepare(`SELECT item_id, tag_id FROM item_tags WHERE item_id = ?`).bind(itemId)
    : db.prepare(`SELECT item_id, tag_id FROM item_tags`);
  return (await stmt.all<ItemTagRecord>()).results;
}

export async function listOccurrences(db: D1Database, itemId?: string): Promise<OccurrenceRecord[]> {
  const cols = `id, item_id, start_date, end_date, starts_at, ends_at, precision, status`;
  const stmt = itemId
    ? db.prepare(`SELECT ${cols} FROM event_occurrences WHERE item_id = ? ORDER BY start_date, starts_at, id`).bind(itemId)
    : db.prepare(`SELECT ${cols} FROM event_occurrences`);
  return (await stmt.all<OccurrenceRecord>()).results;
}

export async function getPlace(db: D1Database, id: string): Promise<PlaceRecord | null> {
  return db.prepare(`SELECT ${PLACE_COLUMNS} FROM places WHERE id = ?`).bind(id).first<PlaceRecord>();
}

export async function listPlaces(db: D1Database): Promise<PlaceRecord[]> {
  return (await db.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY name, id`).all<PlaceRecord>()).results;
}

export async function listTransportPreferences(
  db: D1Database,
  placeId?: string,
): Promise<TransportPreferenceRecord[]> {
  const cols = `place_id, mode, visibility, note`;
  const stmt = placeId
    ? db.prepare(`SELECT ${cols} FROM place_transport_preferences WHERE place_id = ?`).bind(placeId)
    : db.prepare(`SELECT ${cols} FROM place_transport_preferences`);
  return (await stmt.all<TransportPreferenceRecord>()).results;
}

export async function listTravelEstimates(db: D1Database, placeId?: string): Promise<TravelEstimateRecord[]> {
  const cols = `id, place_id, origin_version, mode, source, route_status, minutes, basis,
    walk_minutes, transfers, note, observed_at`;
  const stmt = placeId
    ? db.prepare(`SELECT ${cols} FROM travel_estimates WHERE place_id = ?`).bind(placeId)
    : db.prepare(`SELECT ${cols} FROM travel_estimates`);
  return (await stmt.all<TravelEstimateRecord>()).results;
}

export async function getSettings(db: D1Database): Promise<FamilySettingsRecord> {
  const row = await db
    .prepare(
      `SELECT origin_label, origin_latitude, origin_longitude, origin_version,
              bicycle_max_minutes, version, updated_at
         FROM family_settings WHERE id = 1`,
    )
    .first<FamilySettingsRecord>();
  if (!row) throw new Error("family_settings row is missing");
  return row;
}

/** 表示中の写真（候補・場所ごとに並び順どおり） */
export async function listActiveMedia(db: D1Database): Promise<MediaRecord[]> {
  const { results } = await db
    .prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE status = 'active' ORDER BY sort_order, created_at, id`)
    .all<MediaRecord>();
  return results;
}

export async function listMediaFor(
  db: D1Database,
  target: { itemId: string; placeId: string | null },
  includeHidden = false,
): Promise<MediaRecord[]> {
  const status = includeHidden ? "" : "AND status = 'active'";
  const { results } = await db
    .prepare(
      `SELECT ${MEDIA_COLUMNS} FROM media
        WHERE (item_id = ? OR place_id = ?) ${status}
        ORDER BY item_id IS NULL, sort_order, created_at, id`,
    )
    .bind(target.itemId, target.placeId)
    .all<MediaRecord>();
  return results;
}

export async function getActiveMedia(db: D1Database, id: string): Promise<MediaRecord | null> {
  return db
    .prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ? AND status = 'active'`)
    .bind(id)
    .first<MediaRecord>();
}

// ---- お気に入り・プロフィール ----

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
