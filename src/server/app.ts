import { Hono } from "hono";
import type { Context } from "hono";
import type {
  ItemCard,
  ItemDetailResponse,
  ItemListResponse,
  ProfileListResponse,
} from "../domain/api";
import { idSchema, type ItemRecord, type PlaceRecord } from "../domain/model";
import { favoriteIndex, parseSearchQuery, searchItems } from "../domain/search";
import { requireFamily, requireSameOrigin } from "./auth";
import * as repo from "./repo";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
});
app.use("*", requireFamily());
app.use("/api/*", async (c, next) => {
  await next();
  // 家族のデータを共有キャッシュに載せない
  c.header("Cache-Control", "private, no-store");
});
app.use("/api/*", requireSameOrigin());

app.get("/api/profiles", async (c) => {
  const profiles = await repo.listActiveProfiles(c.env.DB);
  const body: ProfileListResponse = {
    profiles: profiles.map(({ id, display_name, age_hint }) => ({ id, display_name, age_hint })),
  };
  return c.json(body);
});

app.get("/api/items", async (c) => {
  const parsed = parseSearchQuery(new URL(c.req.url).searchParams);
  if (!parsed.success) return c.json({ error: "invalid query" }, 400);
  const query = parsed.data;

  const [items, favorites] = await Promise.all([
    repo.listPublishedItems(c.env.DB),
    repo.listFavorites(c.env.DB),
  ]);
  const result = searchItems(items, favorites, query);
  const places = await repo.getPlaces(
    c.env.DB,
    result.items.flatMap((i) => (i.place_id ? [i.place_id] : [])),
  );
  const savedBy = favoriteIndex(favorites);
  const body: ItemListResponse = {
    items: result.items.map((item) => toCard(item, places, savedBy)),
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  };
  return c.json(body);
});

app.get("/api/items/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const item = await repo.getPublishedItem(c.env.DB, id.data);
  if (!item) return notFound(c);
  const [places, favorites] = await Promise.all([
    repo.getPlaces(c.env.DB, item.place_id ? [item.place_id] : []),
    repo.listFavoritesForItem(c.env.DB, item.id),
  ]);
  const place = item.place_id ? places.get(item.place_id) : undefined;
  const body: ItemDetailResponse = {
    ...toCard(item, places, favoriteIndex(favorites)),
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
  };
  return c.json(body);
});

app.put("/api/profiles/:profileId/favorites/:itemId", async (c) => {
  const ids = await resolveFavoriteTarget(c);
  if (!ids) return notFound(c);
  await repo.addFavorite(c.env.DB, ids.profileId, ids.itemId, new Date().toISOString());
  return c.body(null, 204);
});

app.delete("/api/profiles/:profileId/favorites/:itemId", async (c) => {
  const profileId = idSchema.safeParse(c.req.param("profileId"));
  const itemId = idSchema.safeParse(c.req.param("itemId"));
  if (!profileId.success || !itemId.success) return notFound(c);
  // 非公開になった候補の保存も解除できるよう、候補の公開状態は問わない
  await repo.removeFavorite(c.env.DB, profileId.data, itemId.data);
  return c.body(null, 204);
});

app.all("/api/*", (c) => notFound(c));

// 画面（静的アセット）も認証を通した後に返す
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-cache");
  return out;
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

function toCard(
  item: ItemRecord,
  places: Map<string, PlaceRecord>,
  savedBy: Map<string, Set<string>>,
): ItemCard {
  const place = item.place_id ? places.get(item.place_id) : undefined;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    child_description: item.child_description,
    rain_policy: item.rain_policy,
    place: place ? { id: place.id, name: place.name } : null,
    saved_by_profile_ids: [...(savedBy.get(item.id) ?? [])].sort(),
  };
}

async function resolveFavoriteTarget(c: Context<AppEnv>) {
  const profileId = idSchema.safeParse(c.req.param("profileId"));
  const itemId = idSchema.safeParse(c.req.param("itemId"));
  if (!profileId.success || !itemId.success) return null;
  const [profileOk, item] = await Promise.all([
    repo.isActiveProfile(c.env.DB, profileId.data),
    repo.getPublishedItem(c.env.DB, itemId.data),
  ]);
  if (!profileOk || !item) return null;
  return { profileId: profileId.data, itemId: itemId.data };
}

function notFound(c: Context<AppEnv>) {
  return c.json({ error: "not found" }, 404);
}
