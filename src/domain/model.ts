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

/** アプリ独自 ID。外部 ID や URL を主キーにしない */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export interface PlaceRecord {
  id: string;
  name: string;
  address_text: string | null;
  latitude: number | null;
  longitude: number | null;
  position_accuracy: PositionAccuracy;
  google_place_id: string | null;
  google_maps_url: string | null;
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
  created_at: string;
}

export interface ProfileRecord {
  id: string;
  display_name: string;
  age_hint: number | null;
  sort_order: number;
}

export interface FavoriteRecord {
  profile_id: string;
  item_id: string;
  created_at: string;
}
