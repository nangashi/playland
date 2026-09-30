import type { AdminInboxEntry, AdminSourceEntry } from "../domain/api";
import type {
  BookmarkRecord,
  FamilySettingsRecord,
  HiddenRecord,
  ItemRecord,
  ItemTagRecord,
  MediaRecord,
  PlaceRecord,
  TransportPreferenceRecord,
  TravelEstimateRecord,
} from "../domain/model";
import type { AdminItemSummary } from "../domain/api";
import { homeDistanceKm, originOf, type LatLng } from "../domain/trip";

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
  google_place_id, google_maps_url, position_source, position_note, home_distance_km, version`;

const MEDIA_COLUMNS = `id, r2_key, item_id, place_id, kind, source_url, credit, caption, license_note,
  content_type, byte_size, status, sort_order, created_at`;

export async function listPublishedItems(db: D1Database): Promise<ItemRecord[]> {
  const { results } = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE publish_status = 'published'`)
    .all<ItemRecord>();
  return results;
}

/** 管理画面の一覧用。公開状態を問わず、下書き→公開→非表示、それぞれ更新の新しい順 */
export async function listAdminItems(db: D1Database): Promise<AdminItemSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.title, i.publish_status, i.place_id, p.name AS place_name, i.updated_at
         FROM items i LEFT JOIN places p ON p.id = i.place_id
        ORDER BY CASE i.publish_status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
                 i.updated_at DESC, i.id`,
    )
    .all<AdminItemSummary>();
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

/** 自宅の座標（場所の距離の計算用。画面には返さない） */
export async function getOrigin(db: D1Database): Promise<LatLng | null> {
  return originOf(await getSettings(db));
}

/**
 * すべての場所について、自宅からの距離を計算し直して保存する（自宅を変えたとき・既存データの補完）。
 * 座標から決まる値なので、場所の版・更新日時は変えない。変わった場所の数を返す。
 */
export async function refreshHomeDistances(db: D1Database): Promise<number> {
  const origin = await getOrigin(db);
  const { results } = await db
    .prepare(`SELECT id, latitude, longitude, home_distance_km FROM places`)
    .all<Pick<PlaceRecord, "id" | "latitude" | "longitude" | "home_distance_km">>();
  const stmts = results.flatMap((p) => {
    const km = homeDistanceKm(p, origin);
    if (km === p.home_distance_km) return [];
    // 計算中に座標が変わっていたら書かない（その変更の側で計算する）
    return [
      db
        .prepare(`UPDATE places SET home_distance_km = ? WHERE id = ? AND latitude IS ? AND longitude IS ?`)
        .bind(km, p.id, p.latitude, p.longitude),
    ];
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return stmts.length;
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

/** 親の画面用（非表示・採用待ちも返す） */
export async function getMedia(db: D1Database, id: string): Promise<MediaRecord | null> {
  return db.prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ?`).bind(id).first<MediaRecord>();
}

export async function getActiveMedia(db: D1Database, id: string): Promise<MediaRecord | null> {
  return db
    .prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ? AND status = 'active'`)
    .bind(id)
    .first<MediaRecord>();
}

// ---- 家族の保存 ----

export async function listBookmarks(db: D1Database): Promise<BookmarkRecord[]> {
  const { results } = await db.prepare(`SELECT item_id, created_at, rank FROM bookmarks`).all<BookmarkRecord>();
  return results;
}

export async function isBookmarked(db: D1Database, itemId: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS ok FROM bookmarks WHERE item_id = ?`).bind(itemId).first()) !== null;
}

/** 何度呼んでも 1 件だけ残る（冪等）。新しく保存したものはランキングの最後に入る */
export async function addBookmark(db: D1Database, itemId: string, now: string) {
  await db
    .prepare(
      `INSERT INTO bookmarks (item_id, created_at, rank)
       VALUES (?, ?, (SELECT COALESCE(MAX(rank), 0) + 1 FROM bookmarks))
       ON CONFLICT (item_id) DO NOTHING`,
    )
    .bind(itemId, now)
    .run();
}

/** 保存全体の順（上位から）で順位を振り直す（1 トランザクション） */
export async function setBookmarkOrder(db: D1Database, itemIds: readonly string[]) {
  if (itemIds.length === 0) return;
  await db.batch(
    itemIds.map((id, i) => db.prepare(`UPDATE bookmarks SET rank = ? WHERE item_id = ?`).bind(i + 1, id)),
  );
}

/** 存在しなくても成功扱い（冪等） */
export async function removeBookmark(db: D1Database, itemId: string) {
  await db.prepare(`DELETE FROM bookmarks WHERE item_id = ?`).bind(itemId).run();
}

// ---- 家族の「興味なし」 ----

export async function listHidden(db: D1Database): Promise<HiddenRecord[]> {
  const { results } = await db.prepare(`SELECT item_id, created_at FROM hidden_items`).all<HiddenRecord>();
  return results;
}

export async function isHidden(db: D1Database, itemId: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS ok FROM hidden_items WHERE item_id = ?`).bind(itemId).first()) !== null;
}

/** 何度呼んでも 1 件だけ残る（冪等） */
export async function addHidden(db: D1Database, itemId: string, now: string) {
  await db
    .prepare(`INSERT INTO hidden_items (item_id, created_at) VALUES (?, ?) ON CONFLICT (item_id) DO NOTHING`)
    .bind(itemId, now)
    .run();
}

/** 存在しなくても成功扱い（冪等） */
export async function removeHidden(db: D1Database, itemId: string) {
  await db.prepare(`DELETE FROM hidden_items WHERE item_id = ?`).bind(itemId).run();
}

// ---- 承認待ち ----

/** 下書きの候補と、採用待ちの写真がある候補（古い順）。出典の根拠・要確認も添える */
export async function listInbox(db: D1Database): Promise<AdminInboxEntry[]> {
  const { results: items } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM items
        WHERE publish_status = 'draft'
           OR id IN (SELECT item_id FROM media WHERE status = 'pending' AND item_id IS NOT NULL)
        ORDER BY created_at, id`,
    )
    .all<ItemRecord>();
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const marks = ids.map(() => "?").join(", ");
  const [tags, sources, media, places] = await Promise.all([
    db.prepare(`SELECT item_id, tag_id FROM item_tags WHERE item_id IN (${marks})`).bind(...ids).all<ItemTagRecord>(),
    db
      .prepare(
        `SELECT item_id, source_id, url, fetched_at, batch_id, evidence, needs_review, suggested_tags
           FROM source_entries WHERE item_id IN (${marks}) ORDER BY created_at, id`,
      )
      .bind(...ids)
      .all<{ item_id: string; source_id: string; url: string; fetched_at: string; batch_id: string; evidence: string; needs_review: string; suggested_tags: string }>(),
    db
      .prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE item_id IN (${marks}) ORDER BY sort_order, created_at, id`)
      .bind(...ids)
      .all<MediaRecord>(),
    listPlaces(db),
  ]);
  const placeMap = new Map(places.map((p) => [p.id, p]));
  const parse = <T>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  };
  return items.map((item) => ({
    item,
    tag_ids: tags.results.filter((t) => t.item_id === item.id).map((t) => t.tag_id).sort(),
    place: item.place_id ? (placeMap.get(item.place_id) ?? null) : null,
    sources: sources.results
      .filter((s) => s.item_id === item.id)
      .map(
        (s): AdminSourceEntry => ({
          source_id: s.source_id,
          url: s.url,
          fetched_at: s.fetched_at,
          batch_id: s.batch_id,
          evidence: parse(s.evidence, []),
          needs_review: parse(s.needs_review, []),
          suggested_tags: parse(s.suggested_tags, []),
        }),
      ),
    media: media.results.filter((m) => m.item_id === item.id),
  }));
}
