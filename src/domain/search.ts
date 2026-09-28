import { z } from "zod";
import { idSchema, type FavoriteRecord, type ItemRecord } from "./model";

export const favoritesFilters = ["all", "mine", "family"] as const;
export type FavoritesFilter = (typeof favoritesFilters)[number];

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

/**
 * 一覧・地図で共有する検索条件。
 * favorites=all は保存状態で絞らない、mine は選択プロフィール、family は家族の誰かが保存済み。
 * profile_id は表示の切り替えに使うだけで、権限の根拠にはしない。
 */
export const searchQuerySchema = z
  .object({
    favorites: z.enum(favoritesFilters).default("all"),
    profile_id: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => q.favorites !== "mine" || q.profile_id !== undefined, {
    message: "favorites=mine には profile_id が必要です",
    path: ["profile_id"],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export function parseSearchQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of ["favorites", "profile_id", "limit", "offset"]) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return searchQuerySchema.safeParse(raw);
}

export interface SearchResult {
  items: ItemRecord[];
  total: number;
}

/**
 * 公開中の候補から条件に合うものを返す純粋関数。
 * 並び順は新着順で固定し、同時刻は ID で安定させる（再読込で並びが変わらない）。
 */
export function searchItems(
  items: readonly ItemRecord[],
  favorites: readonly FavoriteRecord[],
  query: SearchQuery,
): SearchResult {
  const savedBy = favoriteIndex(favorites);
  const matched = items
    .filter((item) => item.publish_status === "published")
    .filter((item) => matchesFavorites(savedBy.get(item.id), query))
    .sort(compareNewestFirst);
  return {
    items: matched.slice(query.offset, query.offset + query.limit),
    total: matched.length,
  };
}

function matchesFavorites(savers: Set<string> | undefined, query: SearchQuery): boolean {
  switch (query.favorites) {
    case "all":
      return true;
    case "family":
      return savers !== undefined && savers.size > 0;
    case "mine":
      return savers !== undefined && query.profile_id !== undefined && savers.has(query.profile_id);
  }
}

function compareNewestFirst(a: ItemRecord, b: ItemRecord): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function favoriteIndex(favorites: readonly FavoriteRecord[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const f of favorites) {
    let savers = index.get(f.item_id);
    if (!savers) index.set(f.item_id, (savers = new Set()));
    savers.add(f.profile_id);
  }
  return index;
}
