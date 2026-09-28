import { transportModes, type TransportMode } from "../domain/model";
import {
  DEFAULT_PAGE_SIZE,
  favoritesFilters,
  purposes,
  rainFilters,
  type FavoritesFilter,
  type Purpose,
  type RainFilter,
} from "../domain/search";
import { ENTRANCES } from "../domain/tags";

/**
 * 画面の検索条件。URL に保持して、詳細から戻っても同じ条件・同じ一覧に戻れるようにする。
 * 入口（entrance）は画面の表現で、API には内部のタグ ID に展開して渡す。
 */
export interface SearchState {
  purpose: Purpose;
  favorites: FavoritesFilter;
  entrances: string[];
  rain: RainFilter;
  /** 選択中プロフィールの年齢で参加資格を絞る */
  byAge: boolean;
  modes: TransportMode[];
  maxMinutes: number | null;
  includeUnknown: boolean;
  pages: number;
}

export const MAX_PAGES = 20;
export const MINUTE_CHOICES = [30, 45, 60, 90] as const;

const entranceIds = new Set(ENTRANCES.map((e) => e.id));

function oneOf<T extends string>(values: readonly T[], v: string | null, fallback: T): T {
  return values.includes(v as T) ? (v as T) : fallback;
}

export function readSearchState(params: URLSearchParams): SearchState {
  const list = (key: string) => (params.get(key) ?? "").split(",").filter((v) => v.length > 0);
  const max = Number.parseInt(params.get("max") ?? "", 10);
  const pages = Number.parseInt(params.get("pages") ?? "1", 10);
  return {
    purpose: oneOf(purposes, params.get("purpose"), "someday"),
    favorites: oneOf(favoritesFilters, params.get("favorites"), "all"),
    entrances: list("e").filter((id) => entranceIds.has(id)),
    rain: oneOf(rainFilters, params.get("rain"), "any"),
    byAge: params.get("age") === "1",
    modes: list("modes").filter((m): m is TransportMode => (transportModes as readonly string[]).includes(m)),
    maxMinutes: Number.isFinite(max) && max > 0 ? max : null,
    includeUnknown: params.get("unknown") === "1",
    pages: Number.isFinite(pages) ? Math.min(Math.max(pages, 1), MAX_PAGES) : 1,
  };
}

export function writeSearchState(state: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.purpose !== "someday") p.set("purpose", state.purpose);
  if (state.favorites !== "all") p.set("favorites", state.favorites);
  if (state.entrances.length > 0) p.set("e", state.entrances.join(","));
  if (state.rain !== "any") p.set("rain", state.rain);
  if (state.byAge) p.set("age", "1");
  if (state.modes.length > 0) p.set("modes", state.modes.join(","));
  if (state.maxMinutes !== null) p.set("max", String(state.maxMinutes));
  if (state.includeUnknown) p.set("unknown", "1");
  if (state.pages > 1) p.set("pages", String(state.pages));
  return p;
}

/** API の検索条件に変換する */
export function toApiParams(
  state: SearchState,
  profile: { id: string; age_hint: number | null },
  page: number,
): URLSearchParams {
  const p = new URLSearchParams({
    purpose: state.purpose,
    favorites: state.favorites,
    profile_id: profile.id,
    rain: state.rain,
    include_unknown: String(state.includeUnknown),
    limit: String(DEFAULT_PAGE_SIZE),
    offset: String(page * DEFAULT_PAGE_SIZE),
  });
  const tagIds = new Set(ENTRANCES.filter((e) => state.entrances.includes(e.id)).flatMap((e) => e.tagIds));
  if (tagIds.size > 0) p.set("tag_ids", [...tagIds].join(","));
  if (state.byAge && profile.age_hint !== null && profile.age_hint <= 18) p.set("age", String(profile.age_hint));
  if (state.modes.length > 0) p.set("modes", state.modes.join(","));
  if (state.maxMinutes !== null) p.set("max_minutes", String(state.maxMinutes));
  return p;
}

/** 結果ゼロのときに、どの条件を外せるかを示すための一覧 */
export function activeConditions(state: SearchState): { key: keyof SearchState; reset: Partial<SearchState> }[] {
  const out: { key: keyof SearchState; reset: Partial<SearchState> }[] = [];
  if (state.favorites !== "all") out.push({ key: "favorites", reset: { favorites: "all" } });
  if (state.entrances.length > 0) out.push({ key: "entrances", reset: { entrances: [] } });
  if (state.rain !== "any") out.push({ key: "rain", reset: { rain: "any" } });
  if (state.byAge) out.push({ key: "byAge", reset: { byAge: false } });
  if (state.modes.length > 0 || state.maxMinutes !== null) {
    out.push({ key: "modes", reset: { modes: [], maxMinutes: null } });
  }
  if (state.purpose === "today") out.push({ key: "purpose", reset: { purpose: "someday" } });
  return out;
}

export const conditionLabel: Partial<Record<keyof SearchState, string>> = {
  favorites: "いきたい だけ",
  entrances: "あそびの しゅるい",
  rain: "あめ",
  byAge: "ねんれい",
  modes: "いきかた・じかん",
  purpose: "きょう だけ",
};
