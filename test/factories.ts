import type {
  ItemRecord,
  TransportPreferenceRecord,
  TravelEstimateRecord,
} from "../src/domain/model";
import { searchQuerySchema, type SearchData, type SearchQuery, type SearchQueryInput } from "../src/domain/search";

export function makeItem(id: string, overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id,
    kind: "spot",
    place_id: `pl-${id}`,
    title: id,
    child_description: null,
    rain_policy: "unknown",
    publish_status: "published",
    official_url: null,
    facility_tags_status: "unassessed",
    experience_tags_status: "unassessed",
    schedule_status: "unknown",
    age_min_kind: "unknown",
    age_min: null,
    age_max_kind: "unknown",
    age_max: null,
    eligibility_raw_text: null,
    guardian_rule: "unknown",
    sibling_rule: "unknown",
    recommended_age_min: null,
    recommended_age_max: null,
    reservation_requirement: "unknown",
    reservation_note: null,
    price_status: "unknown",
    price_text: null,
    initialized_at: "2026-09-01T00:00:00.000Z",
    parent_reviewed_at: null,
    version: 1,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function estimate(
  placeId: string,
  mode: TravelEstimateRecord["mode"],
  overrides: Partial<TravelEstimateRecord> = {},
): TravelEstimateRecord {
  return {
    id: `te-${placeId}-${mode}-${overrides.source ?? "manual"}-${overrides.origin_version ?? 1}`,
    place_id: placeId,
    origin_version: 1,
    mode,
    source: "manual",
    route_status: "estimated",
    minutes: 30,
    basis: "door_to_door",
    walk_minutes: null,
    transfers: null,
    note: null,
    observed_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function pref(
  placeId: string,
  mode: TransportPreferenceRecord["mode"],
  visibility: TransportPreferenceRecord["visibility"],
): TransportPreferenceRecord {
  return { place_id: placeId, mode, visibility, note: null };
}

export function data(overrides: Partial<SearchData> = {}): SearchData {
  return {
    items: [],
    itemTags: [],
    bookmarks: [],
    preferences: [],
    estimates: [],
    settings: { origin_version: 1, bicycle_max_minutes: 20 },
    ...overrides,
  };
}

export function query(input: SearchQueryInput = {}): SearchQuery {
  return searchQuerySchema.parse(input);
}
