import { transportModes, type TransportMode } from "../domain/model";
import { DEFAULT_PAGE_SIZE } from "../domain/search";
import { CATEGORIES, getCategory } from "../domain/tags";

/**
 * 画面の検索条件。URL に保持して、詳細から戻っても同じ条件・同じ一覧に戻れるようにする。
 */
export interface SearchState {
  view: "list" | "map";
  /** カテゴリ（1 つだけ） */
  category: string | null;
  /** 家族で保存したものだけ */
  saved: boolean;
  /** 雨の日でも遊べる */
  rainOk: boolean;
  /** 参加できる年齢 */
  age: number | null;
  modes: TransportMode[];
  maxMinutes: number | null;
  includeUnknown: boolean;
  pages: number;
}

export const MAX_PAGES = 20;
export const MINUTE_CHOICES = [20, 30, 45, 60, 90] as const;
export const AGE_CHOICES = Array.from({ length: 13 }, (_, i) => i);

export function readSearchState(params: URLSearchParams): SearchState {
  const list = (key: string) => (params.get(key) ?? "").split(",").filter((v) => v.length > 0);
  const int = (key: string) => {
    const n = Number.parseInt(params.get(key) ?? "", 10);
    return Number.isFinite(n) ? n : null;
  };
  const cat = params.get("cat");
  const age = int("age");
  const max = int("max");
  const pages = int("pages") ?? 1;
  return {
    view: params.get("view") === "map" ? "map" : "list",
    category: cat && getCategory(cat) ? cat : null,
    saved: params.get("saved") === "1",
    rainOk: params.get("rain") === "1",
    age: age !== null && age >= 0 && age <= 18 ? age : null,
    modes: list("modes").filter((m): m is TransportMode => (transportModes as readonly string[]).includes(m)),
    maxMinutes: max !== null && max > 0 ? max : null,
    includeUnknown: params.get("unknown") === "1",
    pages: Math.min(Math.max(pages, 1), MAX_PAGES),
  };
}

export function writeSearchState(state: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.view === "map") p.set("view", "map");
  if (state.category) p.set("cat", state.category);
  if (state.saved) p.set("saved", "1");
  if (state.rainOk) p.set("rain", "1");
  if (state.age !== null) p.set("age", String(state.age));
  if (state.modes.length > 0) p.set("modes", state.modes.join(","));
  if (state.maxMinutes !== null) p.set("max", String(state.maxMinutes));
  if (state.includeUnknown) p.set("unknown", "1");
  if (state.view === "list" && state.pages > 1) p.set("pages", String(state.pages));
  return p;
}

/** API の検索条件に変換する（一覧と地図で同じ条件を使う） */
export function toApiParams(state: SearchState, page: number): URLSearchParams {
  const p = new URLSearchParams({
    saved: String(state.saved),
    rain: state.rainOk ? "ok" : "any",
    include_unknown: String(state.includeUnknown),
    limit: String(DEFAULT_PAGE_SIZE),
    offset: String(page * DEFAULT_PAGE_SIZE),
  });
  if (state.category) p.set("category", state.category);
  if (state.age !== null) p.set("age", String(state.age));
  if (state.modes.length > 0) p.set("modes", state.modes.join(","));
  if (state.maxMinutes !== null) p.set("max_minutes", String(state.maxMinutes));
  return p;
}

export function toMapApiParams(state: SearchState): URLSearchParams {
  const p = toApiParams(state, 0);
  p.delete("limit");
  p.delete("offset");
  return p;
}

/** 地図の表示位置を覚えるキー（検索条件ごと。ページ数・表示形式は含めない） */
export function mapViewKey(state: SearchState): string {
  return writeSearchState({ ...state, view: "list", pages: 1 }).toString();
}

export interface ActiveCondition {
  label: string;
  reset: Partial<SearchState>;
}

/** 適用中の条件（結果ゼロのときに、どれを外すか選べるようにする） */
export function activeConditions(state: SearchState): ActiveCondition[] {
  const out: ActiveCondition[] = [];
  if (state.category) {
    out.push({ label: CATEGORIES.find((c) => c.id === state.category)?.label ?? "カテゴリ", reset: { category: null } });
  }
  if (state.saved) out.push({ label: "保存済み", reset: { saved: false } });
  if (state.rainOk) out.push({ label: "雨の日でも遊べる", reset: { rainOk: false } });
  if (state.age !== null) out.push({ label: `${state.age}歳が参加できる`, reset: { age: null } });
  if (state.modes.length > 0 || state.maxMinutes !== null) {
    out.push({ label: "移動", reset: { modes: [], maxMinutes: null } });
  }
  return out;
}

export const CLEARED: Partial<SearchState> = {
  category: null,
  saved: false,
  rainOk: false,
  age: null,
  modes: [],
  maxMinutes: null,
  includeUnknown: false,
};
