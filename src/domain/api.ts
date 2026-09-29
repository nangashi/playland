import type {
  FamilySettingsRecord,
  ItemKind,
  ItemRecord,
  MediaKind,
  MediaRecord,
  OccurrenceRecord,
  PlaceRecord,
  PositionAccuracy,
  RainPolicy,
  TransportMode,
  TransportPreferenceRecord,
  TravelEstimateRecord,
} from "./model";
import type { ScheduleSummary } from "./schedule";
import type { UnknownReason } from "./search";
import type { ModeView } from "./transport";

/** 画面と API で共有するレスポンス型 */

export interface PlaceSummary {
  id: string;
  name: string;
}

export interface MediaRef {
  id: string;
  kind: MediaKind;
}

export interface ItemCard {
  id: string;
  kind: ItemKind;
  title: string;
  child_description: string | null;
  rain_policy: RainPolicy;
  place: PlaceSummary | null;
  schedule: ScheduleSummary;
  tag_ids: string[];
  /** この候補を「行きたい」に入れている家族内プロフィール */
  saved_by_profile_ids: string[];
  /** 不明のまま含めた条件 */
  unknown: UnknownReason[];
  finished: boolean;
  /** 会場不明なら null */
  travel: ModeView[] | null;
  matched_modes: TransportMode[] | null;
  cover: MediaRef | null;
}

export interface ItemListResponse {
  items: ItemCard[];
  total: number;
  limit: number;
  offset: number;
}

/** 地図の 1 つの会場。同じ会場の候補（常設・イベント）をまとめる */
export interface MapVenue {
  place: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    position_accuracy: PositionAccuracy;
  };
  items: ItemCard[];
}

export interface MapItemsResponse {
  venues: MapVenue[];
  /** 条件に合う候補の総数（地図に出せないものを含む） */
  total: number;
  /** 会場不明・座標なしで地図に出せない候補の数 */
  unpositioned: number;
  /** 上限を超えて出さなかった会場の数 */
  omitted_venues: number;
  max_markers: number;
}

export interface PlaceDetail extends PlaceSummary {
  address_text: string | null;
  latitude: number | null;
  longitude: number | null;
  position_accuracy: PositionAccuracy;
  google_maps_url: string | null;
}

export interface MediaInfo extends MediaRef {
  credit: string | null;
  source_url: string | null;
}

export type OccurrenceView = Omit<OccurrenceRecord, "item_id">;

export interface ItemDetailResponse extends Omit<ItemCard, "place"> {
  official_url: string | null;
  place: PlaceDetail | null;
  occurrences: OccurrenceView[];
  eligibility: Pick<
    ItemRecord,
    | "age_min_kind"
    | "age_min"
    | "age_max_kind"
    | "age_max"
    | "eligibility_raw_text"
    | "guardian_rule"
    | "sibling_rule"
  >;
  recommended_age_min: number | null;
  recommended_age_max: number | null;
  reservation_requirement: ItemRecord["reservation_requirement"];
  reservation_note: string | null;
  price_status: ItemRecord["price_status"];
  price_text: string | null;
  media: MediaInfo[];
  initialized_at: string | null;
  parent_reviewed_at: string | null;
}

export interface ProfileResponse {
  id: string;
  display_name: string;
  age_hint: number | null;
}

export interface ProfileListResponse {
  profiles: ProfileResponse[];
}

/** 一般の画面向けの設定。自宅の座標は含めない */
export interface PublicSettingsResponse {
  origin_label: string;
  bicycle_max_minutes: number;
}

export interface ErrorResponse {
  error: string;
  /** 版の競合時の最新の版 */
  current_version?: number;
}

// ---- 管理（親）向け ----

export interface AdminSessionResponse {
  active: boolean;
  expires_at: string | null;
}

export interface AdminItemResponse {
  item: ItemRecord;
  tag_ids: string[];
  occurrences: OccurrenceView[];
  place: PlaceRecord | null;
  media: MediaRecord[];
}

export interface AdminPlaceResponse {
  place: PlaceRecord;
  /** ピン修正の初期表示用（親の画面だけ） */
  origin: { latitude: number; longitude: number } | null;
  origin_version: number;
  preferences: TransportPreferenceRecord[];
  /** 現在の出発地点の版での値（手動・経路サービスとも） */
  estimates: TravelEstimateRecord[];
}

export interface AdminPlaceListResponse {
  places: Pick<PlaceRecord, "id" | "name">[];
}

export type AdminSettingsResponse = FamilySettingsRecord;
