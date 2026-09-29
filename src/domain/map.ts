import type { PlaceRecord } from "./model";
import type { SearchEntry } from "./search";

/** 地図に一度に出すマーカー（会場）の上限。超えた場合はその旨を返す */
export const MAX_MAP_MARKERS = 500;

export interface VenueGroup<T> {
  place: Pick<PlaceRecord, "id" | "name" | "latitude" | "longitude" | "position_accuracy">;
  entries: T[];
}

export interface MarkerBuildResult<T> {
  venues: VenueGroup<T>[];
  /** 会場不明・座標なしで地図に出せない候補の数 */
  unpositioned: number;
  /** 上限を超えて地図に出さなかった会場の数 */
  omitted_venues: number;
}

/**
 * 検索結果を会場ごとのマーカーにまとめる。
 * - 同じ会場の常設スポット・イベントは 1 つのマーカーから選べるようにする
 * - 座標のない候補は除外せず、件数として返す（一覧への導線に使う）
 * - 並び順は検索結果の順を保つ（会場は、その会場で最初に現れた候補の順）
 */
export function buildVenueGroups<T extends Pick<SearchEntry, "item">>(
  entries: readonly T[],
  places: ReadonlyMap<string, VenueGroup<T>["place"]>,
  maxMarkers = MAX_MAP_MARKERS,
): MarkerBuildResult<T> {
  const groups = new Map<string, VenueGroup<T>>();
  let unpositioned = 0;
  for (const entry of entries) {
    const placeId = entry.item.place_id;
    const place = placeId ? places.get(placeId) : undefined;
    if (!place || place.latitude === null || place.longitude === null) {
      unpositioned++;
      continue;
    }
    let group = groups.get(place.id);
    if (!group) groups.set(place.id, (group = { place, entries: [] }));
    group.entries.push(entry);
  }
  const all = [...groups.values()];
  return {
    venues: all.slice(0, maxMarkers),
    unpositioned,
    omitted_venues: Math.max(0, all.length - maxMarkers),
  };
}

export interface ScreenPoint {
  id: string;
  x: number;
  y: number;
}

export interface PointCluster {
  ids: string[];
  x: number;
  y: number;
}

/**
 * 画面上で近すぎるマーカー（別々の会場）をまとめる。同じ会場の束ねとは別の処理。
 * 入力順に、既存のまとまりの中心から radius 以内なら加え、なければ新しいまとまりにする。
 */
export function clusterScreenPoints(points: readonly ScreenPoint[], radius: number): PointCluster[] {
  const clusters: (PointCluster & { sx: number; sy: number })[] = [];
  for (const p of points) {
    const hit = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) <= radius);
    if (hit) {
      hit.ids.push(p.id);
      hit.sx += p.x;
      hit.sy += p.y;
      hit.x = hit.sx / hit.ids.length;
      hit.y = hit.sy / hit.ids.length;
    } else {
      clusters.push({ ids: [p.id], x: p.x, y: p.y, sx: p.x, sy: p.y });
    }
  }
  return clusters.map(({ ids, x, y }) => ({ ids, x, y }));
}
