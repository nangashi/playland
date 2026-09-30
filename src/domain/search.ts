import { z } from "zod";
import { ageFit, type Fit } from "./eligibility";
import {
  transportModes,
  type BookmarkRecord,
  type HiddenRecord,
  type ItemRecord,
  type ItemTagRecord,
  type TransportMode,
  type TransportPreferenceRecord,
  type TravelEstimateRecord,
} from "./model";
import { getCategory, getTag } from "./tags";
import { buildModeViews, travelFit, type ModeView, type TransportSettings } from "./transport";

/** ok=雨でもできる根拠があるものだけ */
export const rainFilters = ["any", "ok"] as const;
export type RainFilter = (typeof rainFilters)[number];

/** 不明のため条件に一致と判断できなかった項目 */
export const unknownReasons = ["category", "rain", "age", "travel"] as const;
export type UnknownReason = (typeof unknownReasons)[number];

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");
const modesParam = z
  .string()
  .transform((s) => [...new Set(s.split(",").filter((v) => v.length > 0))])
  .pipe(z.array(z.enum(transportModes)).min(1));

/** 一覧・地図で共有する検索条件 */
export const searchQuerySchema = z.object({
  /** カテゴリ（1 つ）。含まれるタグのどれかに当てはまれば一致 */
  category: z
    .string()
    .refine((id) => getCategory(id) !== undefined, { message: "未定義のカテゴリです" })
    .optional(),
  /** 家族で保存したものだけ */
  saved: boolParam.default(false),
  rain: z.enum(rainFilters).default("any"),
  age: z.coerce.number().int().min(0).max(18).optional(),
  modes: modesParam.optional(),
  max_minutes: z.coerce.number().int().min(1).max(600).optional(),
  include_unknown: boolParam.default(false),
  /** 家族で「興味なし」にしたものも表示する */
  include_hidden: boolParam.default(false),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchQueryInput = z.input<typeof searchQuerySchema>;

const QUERY_KEYS = [
  "category",
  "saved",
  "rain",
  "age",
  "modes",
  "max_minutes",
  "include_unknown",
  "include_hidden",
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
  bookmarks: readonly BookmarkRecord[];
  hidden: readonly HiddenRecord[];
  preferences: readonly TransportPreferenceRecord[];
  estimates: readonly TravelEstimateRecord[];
  settings: TransportSettings;
}

export interface SearchEntry {
  item: ItemRecord;
  tag_ids: string[];
  saved: boolean;
  /** 家族で「興味なし」にした（include_hidden のときだけ true のものが含まれる） */
  hidden: boolean;
  /** 不明のまま含めた条件（include_unknown のときだけ空でない） */
  unknown: UnknownReason[];
  /** 場所不明なら null */
  travel: ModeView[] | null;
  /** 移動条件で絞ったときに一致した手段 */
  matched_modes: TransportMode[] | null;
}

export interface SearchResult {
  entries: SearchEntry[];
  total: number;
}

/**
 * 公開中の常設スポットから条件に合うものを返す純粋関数。一覧と地図の両方がこれを使う。
 * - イベント（開催日のある候補）は次のフェーズまで対象外
 * - 不明は一致としない。include_unknown のときだけ理由付きで後ろに並べる
 * - 既知の不一致（年齢制限外など）は include_unknown でも戻さない
 * - 「興味なし」は include_hidden のときだけ含める
 * - 並び順は固定（一致 → 不明あり → 興味なし、各グループ内は新着順・ID 順）
 */
export function searchItems(data: SearchData, query: SearchQuery): SearchResult {
  const entries = searchAllEntries(data, query);
  return {
    entries: entries.slice(query.offset, query.offset + query.limit),
    total: entries.length,
  };
}

/** ページ分割せずに、条件に合うすべての候補を並び順どおりに返す（地図用） */
export function searchAllEntries(data: SearchData, query: SearchQuery): SearchEntry[] {
  const saved = new Set(data.bookmarks.map((b) => b.item_id));
  const hidden = new Set(data.hidden.map((h) => h.item_id));
  const tagsByItem = groupBy(data.itemTags, (t) => t.item_id);
  const category = query.category ? getCategory(query.category) : undefined;
  const travelModes =
    query.modes || query.max_minutes !== undefined ? new Set(query.modes ?? transportModes) : null;

  const entries: SearchEntry[] = [];
  for (const item of data.items) {
    if (item.publish_status !== "published" || item.kind !== "spot") continue;
    const isSaved = saved.has(item.id);
    if (query.saved && !isSaved) continue;
    const isHidden = hidden.has(item.id);
    if (isHidden && !query.include_hidden) continue;

    const unknown: UnknownReason[] = [];
    const itemTagIds = (tagsByItem.get(item.id) ?? []).map((t) => t.tag_id);
    if (category) {
      const fit = categoryFit(item, new Set(itemTagIds), category.tagIds);
      if (fit === "mismatch") continue;
      if (fit === "unknown") unknown.push("category");
    }

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
      tag_ids: itemTagIds.sort(),
      saved: isSaved,
      hidden: isHidden,
      unknown,
      travel,
      matched_modes: matchedModes,
    });
  }

  entries.sort(compareEntries);
  return entries;
}

function rainFit(policy: ItemRecord["rain_policy"], filter: SearchQuery["rain"]): Fit {
  if (filter === "any") return "match";
  if (policy === "unknown") return "unknown";
  return policy === "ok" ? "match" : "mismatch";
}

/**
 * カテゴリに含まれるタグのどれかを持てば一致。
 * 持っていないとき、関係する分類（施設・体験）のどれかが未判定なら不明、すべて判定済みなら不一致。
 */
function categoryFit(item: ItemRecord, itemTagIds: ReadonlySet<string>, categoryTagIds: readonly string[]): Fit {
  if (categoryTagIds.some((id) => itemTagIds.has(id))) return "match";
  const relevant = new Set(categoryTagIds.map((id) => getTag(id)?.category));
  const unassessed =
    (relevant.has("facility") && item.facility_tags_status === "unassessed") ||
    (relevant.has("experience") && item.experience_tags_status === "unassessed");
  return unassessed ? "unknown" : "mismatch";
}

function compareEntries(a: SearchEntry, b: SearchEntry): number {
  const rank = (e: SearchEntry) => (e.hidden ? 2 : e.unknown.length > 0 ? 1 : 0);
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (a.item.created_at !== b.item.created_at) return a.item.created_at < b.item.created_at ? 1 : -1;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
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
