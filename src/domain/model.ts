import { z } from "zod";

export const itemKinds = ["spot", "event"] as const;
export type ItemKind = (typeof itemKinds)[number];

/** 雨天対応。施設に屋内があるかではなく、目的の体験を雨でもできるか */
export const rainPolicies = ["ok", "conditional", "not_suitable", "unknown"] as const;
export type RainPolicy = (typeof rainPolicies)[number];

export const positionAccuracies = ["exact", "approximate", "unknown"] as const;
export type PositionAccuracy = (typeof positionAccuracies)[number];

export const publishStatuses = ["draft", "published", "hidden"] as const;
export type PublishStatus = (typeof publishStatuses)[number];

export const tagCategories = ["facility", "experience"] as const;
export type TagCategory = (typeof tagCategories)[number];

/** タグの「未判定」と「判定済み（該当なしを含む）」を区別する */
export const tagAssessments = ["assessed", "unassessed"] as const;
export type TagAssessment = (typeof tagAssessments)[number];

export const scheduleStatuses = ["known", "unknown"] as const;
export type ScheduleStatus = (typeof scheduleStatuses)[number];

/** value=数値あり / none=制限なしと明記 / unknown=記載なし・未確認 */
export const ageBoundKinds = ["value", "none", "unknown"] as const;
export type AgeBoundKind = (typeof ageBoundKinds)[number];

export const guardianRules = ["required", "not_required", "unknown"] as const;
export type GuardianRule = (typeof guardianRules)[number];

export const siblingRules = ["allowed", "not_allowed", "unknown"] as const;
export type SiblingRule = (typeof siblingRules)[number];

export const reservationRequirements = ["required", "not_required", "unknown"] as const;
export type ReservationRequirement = (typeof reservationRequirements)[number];

export const priceStatuses = ["free", "paid", "unknown"] as const;
export type PriceStatus = (typeof priceStatuses)[number];

export const occurrencePrecisions = ["date", "datetime"] as const;
export type OccurrencePrecision = (typeof occurrencePrecisions)[number];

export const occurrenceStatuses = ["scheduled", "cancelled"] as const;
export type OccurrenceStatus = (typeof occurrenceStatuses)[number];

export const transportModes = ["transit", "car", "bicycle"] as const;
export type TransportMode = (typeof transportModes)[number];

export const modeVisibilities = ["default", "show", "hide"] as const;
export type ModeVisibility = (typeof modeVisibilities)[number];

export const routeStatuses = ["estimated", "no_route"] as const;
export type RouteStatus = (typeof routeStatuses)[number];

/** door_to_door=自宅から入口まで / driving_only=運転時間だけ */
export const durationBases = ["door_to_door", "driving_only"] as const;
export type DurationBasis = (typeof durationBases)[number];

export const estimateSources = ["manual", "api"] as const;
export type EstimateSource = (typeof estimateSources)[number];

/** 会場の写真 / 過去の開催風景 / イメージ */
export const mediaKinds = ["venue", "past_event", "image"] as const;
export type MediaKind = (typeof mediaKinds)[number];

/** アプリ独自 ID。外部 ID や URL を主キーにしない */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** YYYY-MM-DD（Asia/Tokyo の暦日） */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
    message: "存在しない日付です",
  });

export interface PlaceRecord {
  id: string;
  name: string;
  address_text: string | null;
  latitude: number | null;
  longitude: number | null;
  position_accuracy: PositionAccuracy;
  google_place_id: string | null;
  google_maps_url: string | null;
  position_source: PositionSource | null;
  position_note: string | null;
  version: number;
}

export interface ItemRecord {
  id: string;
  kind: ItemKind;
  place_id: string | null;
  title: string;
  child_description: string | null;
  rain_policy: RainPolicy;
  publish_status: PublishStatus;
  official_url: string | null;
  facility_tags_status: TagAssessment;
  experience_tags_status: TagAssessment;
  schedule_status: ScheduleStatus;
  age_min_kind: AgeBoundKind;
  age_min: number | null;
  age_max_kind: AgeBoundKind;
  age_max: number | null;
  eligibility_raw_text: string | null;
  guardian_rule: GuardianRule;
  sibling_rule: SiblingRule;
  recommended_age_min: number | null;
  recommended_age_max: number | null;
  reservation_requirement: ReservationRequirement;
  reservation_note: string | null;
  price_status: PriceStatus;
  price_text: string | null;
  initialized_at: string | null;
  parent_reviewed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface OccurrenceRecord {
  id: string;
  item_id: string;
  start_date: string;
  end_date: string;
  starts_at: string | null;
  ends_at: string | null;
  precision: OccurrencePrecision;
  status: OccurrenceStatus;
}

export interface ItemTagRecord {
  item_id: string;
  tag_id: string;
}

/** 家族で「興味なし」にした候補 */
export interface HiddenRecord {
  item_id: string;
  created_at: string;
}

export const positionSources = ["parent", "source_page", "geocoder"] as const;
export type PositionSource = (typeof positionSources)[number];

/** 家族で共有する保存（ブックマーク） */
export interface BookmarkRecord {
  item_id: string;
  created_at: string;
  /** ランキングの順位（小さいほど上位）。新しく保存したものは最後 */
  rank: number;
}

export interface MediaRecord {
  id: string;
  r2_key: string;
  item_id: string | null;
  place_id: string | null;
  kind: MediaKind;
  source_url: string | null;
  credit: string | null;
  caption: string | null;
  license_note: string | null;
  content_type: string;
  byte_size: number;
  status: "active" | "hidden";
  sort_order: number;
  created_at: string;
}

export interface TransportPreferenceRecord {
  place_id: string;
  mode: TransportMode;
  visibility: ModeVisibility;
  note: string | null;
}

export interface TravelEstimateRecord {
  id: string;
  place_id: string;
  origin_version: number;
  mode: TransportMode;
  source: EstimateSource;
  route_status: RouteStatus;
  minutes: number | null;
  basis: DurationBasis | null;
  walk_minutes: number | null;
  transfers: number | null;
  note: string | null;
  observed_at: string;
}

export interface FamilySettingsRecord {
  origin_label: string;
  origin_latitude: number | null;
  origin_longitude: number | null;
  origin_version: number;
  bicycle_max_minutes: number;
  version: number;
  updated_at: string;
}
