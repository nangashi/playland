import { Hono } from "hono";
import type { Context } from "hono";
import type {
  ItemCard,
  ItemDetailResponse,
  ItemListResponse,
  MediaRef,
  ProfileListResponse,
  PublicSettingsResponse,
} from "../domain/api";
import { idSchema, type MediaRecord, type PlaceRecord } from "../domain/model";
import { summarizeSchedule } from "../domain/schedule";
import { parseSearchQuery, searchItems, type SearchData, type SearchEntry } from "../domain/search";
import { buildModeViews } from "../domain/transport";
import * as repo from "./repo";
import type { AppEnv } from "./types";

export const publicApi = new Hono<AppEnv>();

publicApi.get("/profiles", async (c) => {
  const profiles = await repo.listActiveProfiles(c.env.DB);
  const body: ProfileListResponse = {
    profiles: profiles.map(({ id, display_name, age_hint }) => ({ id, display_name, age_hint })),
  };
  return c.json(body);
});

/** 自宅の座標は返さない */
publicApi.get("/settings", async (c) => {
  const s = await repo.getSettings(c.env.DB);
  const body: PublicSettingsResponse = {
    origin_label: s.origin_label,
    bicycle_max_minutes: s.bicycle_max_minutes,
  };
  return c.json(body);
});

publicApi.get("/items", async (c) => {
  const parsed = parseSearchQuery(new URL(c.req.url).searchParams);
  if (!parsed.success) return c.json({ error: "invalid query" }, 400);
  const query = parsed.data;

  const db = c.env.DB;
  const [data, places, media] = await Promise.all([
    loadSearchData(db),
    repo.listPlaces(db),
    repo.listActiveMedia(db),
  ]);
  const result = searchItems(data, query, new Date());
  const placeMap = new Map(places.map((p) => [p.id, p]));
  const covers = coverIndex(media);
  const body: ItemListResponse = {
    items: result.entries.map((e) => toCard(e, placeMap, covers)),
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  };
  return c.json(body);
});

publicApi.get("/items/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const db = c.env.DB;
  const item = await repo.getPublishedItem(db, id.data);
  if (!item) return notFound(c);

  const [place, tags, occurrences, favorites, preferences, estimates, settings, media] = await Promise.all([
    item.place_id ? repo.getPlace(db, item.place_id) : null,
    repo.listItemTags(db, item.id),
    repo.listOccurrences(db, item.id),
    repo.listFavoritesForItem(db, item.id),
    item.place_id ? repo.listTransportPreferences(db, item.place_id) : [],
    item.place_id ? repo.listTravelEstimates(db, item.place_id) : [],
    repo.getSettings(db),
    repo.listMediaFor(db, { itemId: item.id, placeId: item.place_id }),
  ]);
  const schedule = summarizeSchedule(item, occurrences, new Date());
  const entry: SearchEntry = {
    item,
    schedule,
    tag_ids: tags.map((t) => t.tag_id).sort(),
    saved_by_profile_ids: favorites.map((f) => f.profile_id).sort(),
    unknown: [],
    travel: item.place_id ? buildModeViews(item.place_id, preferences, estimates, settings) : null,
    matched_modes: null,
    finished: schedule.state === "ended" || schedule.state === "cancelled",
  };
  const placeMap = new Map(place ? [[place.id, place]] : []);
  const card = toCard(entry, placeMap, coverIndex(media));
  const body: ItemDetailResponse = {
    ...card,
    official_url: item.official_url,
    place: place
      ? {
          id: place.id,
          name: place.name,
          address_text: place.address_text,
          latitude: place.latitude,
          longitude: place.longitude,
          position_accuracy: place.position_accuracy,
          google_maps_url: place.google_maps_url,
        }
      : null,
    occurrences: occurrences.map(({ item_id: _, ...o }) => o),
    eligibility: {
      age_min_kind: item.age_min_kind,
      age_min: item.age_min,
      age_max_kind: item.age_max_kind,
      age_max: item.age_max,
      eligibility_raw_text: item.eligibility_raw_text,
      guardian_rule: item.guardian_rule,
      sibling_rule: item.sibling_rule,
    },
    recommended_age_min: item.recommended_age_min,
    recommended_age_max: item.recommended_age_max,
    reservation_requirement: item.reservation_requirement,
    reservation_note: item.reservation_note,
    price_status: item.price_status,
    price_text: item.price_text,
    media: media.map((m) => ({ id: m.id, kind: m.kind, credit: m.credit, source_url: m.source_url })),
    initialized_at: item.initialized_at,
    parent_reviewed_at: item.parent_reviewed_at,
  };
  return c.json(body);
});

publicApi.put("/profiles/:profileId/favorites/:itemId", async (c) => {
  const profileId = idSchema.safeParse(c.req.param("profileId"));
  const itemId = idSchema.safeParse(c.req.param("itemId"));
  if (!profileId.success || !itemId.success) return notFound(c);
  const [profileOk, item] = await Promise.all([
    repo.isActiveProfile(c.env.DB, profileId.data),
    repo.getPublishedItem(c.env.DB, itemId.data),
  ]);
  if (!profileOk || !item) return notFound(c);
  await repo.addFavorite(c.env.DB, profileId.data, itemId.data, new Date().toISOString());
  return c.body(null, 204);
});

publicApi.delete("/profiles/:profileId/favorites/:itemId", async (c) => {
  const profileId = idSchema.safeParse(c.req.param("profileId"));
  const itemId = idSchema.safeParse(c.req.param("itemId"));
  if (!profileId.success || !itemId.success) return notFound(c);
  // 非公開になった候補の保存も解除できるよう、候補の公開状態は問わない
  await repo.removeFavorite(c.env.DB, profileId.data, itemId.data);
  return c.body(null, 204);
});

export async function loadSearchData(db: D1Database): Promise<SearchData> {
  const [items, itemTags, occurrences, favorites, preferences, estimates, settings] = await Promise.all([
    repo.listPublishedItems(db),
    repo.listItemTags(db),
    repo.listOccurrences(db),
    repo.listFavorites(db),
    repo.listTransportPreferences(db),
    repo.listTravelEstimates(db),
    repo.getSettings(db),
  ]);
  return { items, itemTags, occurrences, favorites, preferences, estimates, settings };
}

interface CoverIndex {
  byItem: Map<string, MediaRef>;
  byPlace: Map<string, MediaRef>;
}

/** 候補自身の写真を優先し、なければ会場の写真（kind で「会場の写真」と分かる） */
function coverIndex(media: readonly MediaRecord[]): CoverIndex {
  const byItem = new Map<string, MediaRef>();
  const byPlace = new Map<string, MediaRef>();
  for (const m of media) {
    if (m.status !== "active") continue;
    if (m.item_id && !byItem.has(m.item_id)) byItem.set(m.item_id, { id: m.id, kind: m.kind });
    if (m.place_id && !byPlace.has(m.place_id)) byPlace.set(m.place_id, { id: m.id, kind: m.kind });
  }
  return { byItem, byPlace };
}

function toCard(entry: SearchEntry, places: Map<string, PlaceRecord>, covers: CoverIndex): ItemCard {
  const { item } = entry;
  const place = item.place_id ? places.get(item.place_id) : undefined;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    child_description: item.child_description,
    rain_policy: item.rain_policy,
    place: place ? { id: place.id, name: place.name } : null,
    schedule: entry.schedule,
    tag_ids: entry.tag_ids,
    saved_by_profile_ids: entry.saved_by_profile_ids,
    unknown: entry.unknown,
    finished: entry.finished,
    travel: entry.travel,
    matched_modes: entry.matched_modes,
    cover: covers.byItem.get(item.id) ?? (item.place_id ? covers.byPlace.get(item.place_id) : undefined) ?? null,
  };
}

function notFound(c: Context<AppEnv>) {
  return c.json({ error: "not found" }, 404);
}
