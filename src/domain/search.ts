import { z } from "zod";
import { ageFit, combineFits, type Fit } from "./eligibility";
import {
  idSchema,
  transportModes,
  type FavoriteRecord,
  type ItemRecord,
  type ItemTagRecord,
  type OccurrenceRecord,
  type TagCategory,
  type TransportMode,
  type TransportPreferenceRecord,
  type TravelEstimateRecord,
} from "./model";
import { isFinished, summarizeSchedule, type ScheduleSummary } from "./schedule";
import { getTag, isKnownTagId } from "./tags";
import { buildModeViews, travelFit, type ModeView, type TransportSettings } from "./transport";

export const favoritesFilters = ["all", "mine", "family"] as const;
export type FavoritesFilter = (typeof favoritesFilters)[number];

export const purposes = ["today", "someday"] as const;
export type Purpose = (typeof purposes)[number];

/** ok=雨でもできる根拠があるものだけ / ok_or_conditional=条件付きも含める */
export const rainFilters = ["any", "ok", "ok_or_conditional"] as const;
export type RainFilter = (typeof rainFilters)[number];

/** 不明のため条件に一致と判断できなかった項目 */
export const unknownReasons = ["schedule", "tags", "rain", "age", "travel"] as const;
export type UnknownReason = (typeof unknownReasons)[number];

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");

/** カンマ区切りの一覧。空・重複は除く */
const commaList = z.string().transform((s) => [...new Set(s.split(",").filter((v) => v.length > 0))]);

const tagIdsParam = commaList.pipe(
  z.array(z.string().refine(isKnownTagId, { message: "未定義のタグです" })).min(1).max(50),
);
const modesParam = commaList.pipe(z.array(z.enum(transportModes)).min(1));

/**
 * 一覧・地図で共有する検索条件。
 * profile_id は表示の切り替えに使うだけで、権限の根拠にはしない。
 */
export const searchQuerySchema = z
  .object({
    purpose: z.enum(purposes).default("someday"),
    favorites: z.enum(favoritesFilters).default("all"),
    profile_id: idSchema.optional(),
    tag_ids: tagIdsParam.optional(),
    rain: z.enum(rainFilters).default("any"),
    age: z.coerce.number().int().min(0).max(18).optional(),
    modes: modesParam.optional(),
    max_minutes: z.coerce.number().int().min(1).max(600).optional(),
    include_unknown: boolParam.default(false),
    include_ended: boolParam.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => q.favorites !== "mine" || q.profile_id !== undefined, {
    message: "favorites=mine には profile_id が必要です",
    path: ["profile_id"],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchQueryInput = z.input<typeof searchQuerySchema>;

const QUERY_KEYS = [
  "purpose",
  "favorites",
  "profile_id",
  "tag_ids",
  "rain",
  "age",
  "modes",
  "max_minutes",
  "include_unknown",
  "include_ended",
  "limit",
  "offset",
] as const;

export function parseSearchQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return searchQuerySchema.safeParse(raw);
}

export interface SearchData {
  items: readonly ItemRecord[];
  itemTags: readonly ItemTagRecord[];
  occurrences: readonly OccurrenceRecord[];
  favorites: readonly FavoriteRecord[];
  preferences: readonly TransportPreferenceRecord[];
  estimates: readonly TravelEstimateRecord[];
  settings: TransportSettings;
}

export interface SearchEntry {
  item: ItemRecord;
  schedule: ScheduleSummary;
  tag_ids: string[];
  saved_by_profile_ids: string[];
  /** 不明のまま含めた条件（include_unknown のときだけ空でない） */
  unknown: UnknownReason[];
  /** 会場不明なら null */
  travel: ModeView[] | null;
  /** 移動条件で絞ったときに一致した手段 */
  matched_modes: TransportMode[] | null;
  /** 終了・中止済み（お気に入り履歴として表示するとき） */
  finished: boolean;
}

export interface SearchResult {
  entries: SearchEntry[];
  total: number;
}

/**
 * 公開中の候補から条件に合うものを返す純粋関数。一覧と地図の両方がこれを使う。
 * - 同じ分類内のタグは OR、分類間は AND
 * - 不明は一致としない。include_unknown のときだけ理由付きで後ろに並べる
 * - 既知の不一致（年齢制限外など）は include_unknown でも戻さない
 * - 並び順は固定（一致 → 不明あり → 終了済み、各グループ内は新着順・ID 順）
 */
export function searchItems(data: SearchData, query: SearchQuery, now: Date): SearchResult {
  const savedBy = favoriteIndex(data.favorites);
  const tagsByItem = groupBy(data.itemTags, (t) => t.item_id);
  const occurrencesByItem = groupBy(data.occurrences, (o) => o.item_id);
  const selectedTags = groupSelectedTags(query.tag_ids ?? []);
  const includeEnded = query.include_ended ?? query.favorites !== "all";
  const travelModes =
    query.modes || query.max_minutes !== undefined ? new Set(query.modes ?? transportModes) : null;

  const entries: SearchEntry[] = [];
  for (const item of data.items) {
    if (item.publish_status !== "published") continue;
    const savers = savedBy.get(item.id);
    if (!matchesFavorites(savers, query)) continue;

    const unknown: UnknownReason[] = [];
    const schedule = summarizeSchedule(item, occurrencesByItem.get(item.id) ?? [], now);
    const finished = isFinished(schedule.state);
    const scheduleResult = scheduleFit(schedule, query.purpose, includeEnded);
    if (scheduleResult === "mismatch") continue;
    if (scheduleResult === "unknown") unknown.push("schedule");

    const itemTagIds = (tagsByItem.get(item.id) ?? []).map((t) => t.tag_id);
    const tagResult = tagFit(item, new Set(itemTagIds), selectedTags);
    if (tagResult === "mismatch") continue;
    if (tagResult === "unknown") unknown.push("tags");

    const rainResult = rainFit(item.rain_policy, query.rain);
    if (rainResult === "mismatch") continue;
    if (rainResult === "unknown") unknown.push("rain");

    if (query.age !== undefined) {
      const fit = ageFit(item, query.age);
      if (fit === "mismatch") continue;
      if (fit === "unknown") unknown.push("age");
    }

    const travel = item.place_id
      ? buildModeViews(item.place_id, data.preferences, data.estimates, data.settings)
      : null;
    let matchedModes: TransportMode[] | null = null;
    if (travelModes) {
      const fit = travelFit(travel, travelModes, query.max_minutes);
      if (fit.fit === "mismatch") continue;
      if (fit.fit === "unknown") unknown.push("travel");
      matchedModes = fit.matched_modes;
    }

    if (unknown.length > 0 && !query.include_unknown) continue;
    entries.push({
      item,
      schedule,
      tag_ids: itemTagIds.sort(),
      saved_by_profile_ids: [...(savers ?? [])].sort(),
      unknown,
      travel,
      matched_modes: matchedModes,
      finished,
    });
  }

  entries.sort(compareEntries);
  return {
    entries: entries.slice(query.offset, query.offset + query.limit),
    total: entries.length,
  };
}

function scheduleFit(schedule: ScheduleSummary, purpose: SearchQuery["purpose"], includeEnded: boolean): Fit {
  if (purpose === "today") {
    // 常設スポットは営業中と断定せず候補に残す（画面で「今日の営業は要確認」と表示）
    if (schedule.state === "always" || schedule.state === "today") return "match";
    if (schedule.state === "unknown") return "unknown";
    return "mismatch";
  }
  // そのうち：今日の日程で狭めない。終了済みは通常外し、履歴表示のときだけ含める
  if (isFinished(schedule.state)) return includeEnded ? "match" : "mismatch";
  return "match";
}

function rainFit(policy: ItemRecord["rain_policy"], filter: SearchQuery["rain"]): Fit {
  if (filter === "any") return "match";
  if (policy === "unknown") return "unknown";
  if (policy === "ok") return "match";
  if (policy === "conditional" && filter === "ok_or_conditional") return "match";
  return "mismatch";
}

function groupSelectedTags(tagIds: readonly string[]): Map<TagCategory, Set<string>> {
  const groups = new Map<TagCategory, Set<string>>();
  for (const id of tagIds) {
    const tag = getTag(id);
    if (!tag) continue;
    let set = groups.get(tag.category);
    if (!set) groups.set(tag.category, (set = new Set()));
    set.add(id);
  }
  return groups;
}

function tagFit(item: ItemRecord, itemTagIds: ReadonlySet<string>, selected: Map<TagCategory, Set<string>>): Fit {
  const fits: Fit[] = [];
  for (const [category, wanted] of selected) {
    const hit = [...wanted].some((id) => itemTagIds.has(id));
    if (hit) {
      fits.push("match");
      continue;
    }
    const status = category === "facility" ? item.facility_tags_status : item.experience_tags_status;
    // 判定済みで該当なしなら不一致、未判定なら不明
    fits.push(status === "assessed" ? "mismatch" : "unknown");
  }
  return combineFits(fits);
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

function compareEntries(a: SearchEntry, b: SearchEntry): number {
  const rank = (e: SearchEntry) => (e.finished ? 2 : e.unknown.length > 0 ? 1 : 0);
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (a.item.created_at !== b.item.created_at) return a.item.created_at < b.item.created_at ? 1 : -1;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
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

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(row);
  }
  return map;
}
