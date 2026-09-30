/** 自宅からの距離で分ける、お出かけの種類。day_trip=日帰り / trip=旅行（泊まりがけの目安） */
export const tripKinds = ["day_trip", "trip"] as const;
export type TripKind = (typeof tripKinds)[number];

/** 自宅からの直線距離がこれ以下なら日帰り、超えれば旅行 */
export const DAY_TRIP_MAX_KM = 100;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** 2 点間の直線距離（km、球面上の大円距離） */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 自宅の座標。未設定なら null */
export function originOf(settings: {
  origin_latitude: number | null;
  origin_longitude: number | null;
}): LatLng | null {
  return settings.origin_latitude !== null && settings.origin_longitude !== null
    ? { latitude: settings.origin_latitude, longitude: settings.origin_longitude }
    : null;
}

/**
 * 場所に保存する、自宅からの直線距離（km、小数 1 桁）。自宅か場所の座標がなければ null。
 * 経路の所要時間は使わない（未登録の場所が多いため）。
 */
export function homeDistanceKm(
  place: { latitude: number | null; longitude: number | null },
  origin: LatLng | null,
): number | null {
  if (!origin || place.latitude === null || place.longitude === null) return null;
  return Math.round(distanceKm(origin, { latitude: place.latitude, longitude: place.longitude }) * 10) / 10;
}

/** 保存した距離から日帰り・旅行を判定する。距離がなければ判定しない（null） */
export function tripKindOf(homeDistance: number | null | undefined): TripKind | null {
  if (homeDistance === null || homeDistance === undefined) return null;
  return homeDistance <= DAY_TRIP_MAX_KM ? "day_trip" : "trip";
}
