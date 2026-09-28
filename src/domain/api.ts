import type { ItemKind, PositionAccuracy, RainPolicy } from "./model";

/** 画面と API で共有するレスポンス型 */

export interface PlaceSummary {
  id: string;
  name: string;
}

export interface ItemCard {
  id: string;
  kind: ItemKind;
  title: string;
  child_description: string | null;
  rain_policy: RainPolicy;
  place: PlaceSummary | null;
  /** この候補を「行きたい」に入れている家族内プロフィール */
  saved_by_profile_ids: string[];
}

export interface ItemListResponse {
  items: ItemCard[];
  total: number;
  limit: number;
  offset: number;
}

export interface PlaceDetail extends PlaceSummary {
  address_text: string | null;
  latitude: number | null;
  longitude: number | null;
  position_accuracy: PositionAccuracy;
  google_maps_url: string | null;
}

export interface ItemDetailResponse extends Omit<ItemCard, "place"> {
  official_url: string | null;
  place: PlaceDetail | null;
}

export interface ProfileResponse {
  id: string;
  display_name: string;
  age_hint: number | null;
}

export interface ProfileListResponse {
  profiles: ProfileResponse[];
}

export interface ErrorResponse {
  error: string;
}
