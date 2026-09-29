import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemCard as ItemCardData, MapVenue } from "../../domain/api";
import { clusterScreenPoints } from "../../domain/map";
import type { Purpose } from "../../domain/search";
import { ItemCard } from "../components/ItemCard";
import { BASE_TILES, FALLBACK_VIEW } from "./tiles";

interface Props {
  venues: MapVenue[];
  /** 表示位置を覚えておくためのキー（検索条件ごと） */
  viewKey: string;
  purpose: Purpose;
  profileId: string;
  profileNames: Map<string, string>;
  onSavedChange: (itemId: string, saved: boolean) => void;
}

/** 近すぎる別々の会場をまとめる半径（px） */
const CLUSTER_RADIUS = 36;

interface SavedView {
  lat: number;
  lng: number;
  zoom: number;
  selected: string[];
}

function loadView(key: string): SavedView | null {
  try {
    const raw = sessionStorage.getItem(`playland.map:${key}`);
    return raw ? (JSON.parse(raw) as SavedView) : null;
  } catch {
    return null;
  }
}

function saveView(key: string, view: SavedView) {
  try {
    sessionStorage.setItem(`playland.map:${key}`, JSON.stringify(view));
  } catch {
    // 保存できなくても地図は使える
  }
}

/**
 * アプリが持つ候補を独自マーカーで表示する地図。
 * - 同じ会場の候補は 1 つのマーカー（数字つき）にまとめる
 * - 画面上で近すぎる別々の会場は、形の違う「まとまり」マーカーにし、押すと拡大する
 * - 選んだマーカーの候補は画面下のカードで見る
 */
export function MapView({ venues, viewKey, purpose, profileId, profileNames, onSavedChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const saved = useMemo(() => loadView(viewKey), [viewKey]);
  const [selected, setSelected] = useState<string[]>(saved?.selected ?? []);
  const [zoom, setZoom] = useState<number | null>(null);

  const venueById = useMemo(() => new Map(venues.map((v) => [v.place.id, v])), [venues]);

  // 地図の生成（1 回だけ）
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      minZoom: BASE_TILES.minZoom,
      maxZoom: BASE_TILES.maxZoom,
    });
    L.tileLayer(BASE_TILES.url, {
      attribution: BASE_TILES.attribution,
      minZoom: BASE_TILES.minZoom,
      maxZoom: BASE_TILES.maxZoom,
      referrerPolicy: "no-referrer",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (saved) {
      map.setView([saved.lat, saved.lng], saved.zoom);
    } else if (venues.length > 0) {
      const bounds = L.latLngBounds(venues.map((v) => [v.place.latitude, v.place.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    } else {
      map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    }
    setZoom(map.getZoom());
    map.on("zoomend", () => setZoom(map.getZoom()));
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // 生成時の初期値だけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 表示位置と選択を覚えて、詳細から戻ったときに同じ場所へ
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const store = () => {
      const c = map.getCenter();
      saveView(viewKey, { lat: c.lat, lng: c.lng, zoom: map.getZoom(), selected });
    };
    store();
    map.on("moveend", store);
    return () => {
      map.off("moveend", store);
    };
  }, [viewKey, selected]);

  // マーカーの描画（ズームが変わるたびに近接をまとめ直す）
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || zoom === null) return;
    layer.clearLayers();
    const points = venues.map((v) => {
      const p = map.project([v.place.latitude, v.place.longitude], zoom);
      return { id: v.place.id, x: p.x, y: p.y };
    });
    for (const cluster of clusterScreenPoints(points, CLUSTER_RADIUS)) {
      const members = cluster.ids.map((id) => venueById.get(id)!).filter(Boolean);
      if (members.length === 1) {
        const v = members[0]!;
        const isSelected = selected.includes(v.place.id);
        const mine = v.items.some((i) => i.saved_by_profile_ids.includes(profileId));
        const marker = L.marker([v.place.latitude, v.place.longitude], {
          icon: L.divIcon({
            className: "",
            html: venueMarkerHtml(v, isSelected, mine),
            iconSize: [40, 40],
            iconAnchor: [20, 40],
          }),
          title: v.place.name,
          keyboard: true,
          riseOnHover: true,
        });
        marker.on("click", () => setSelected([v.place.id]));
        layer.addLayer(marker);
      } else {
        const center = map.unproject([cluster.x, cluster.y], zoom);
        const marker = L.marker(center, {
          icon: L.divIcon({
            className: "",
            html: `<div class="cluster-marker"><span>${members.length}</span><small>かしょ</small></div>`,
            iconSize: [52, 52],
            iconAnchor: [26, 26],
          }),
          title: `${members.length} かしょ`,
          keyboard: true,
        });
        marker.on("click", () => {
          if (zoom >= map.getMaxZoom()) {
            // これ以上拡大できない（ほぼ同じ位置の別の会場）：まとめて選ぶ
            setSelected(members.map((m) => m.place.id));
            return;
          }
          const bounds = L.latLngBounds(members.map((m) => [m.place.latitude, m.place.longitude] as [number, number]));
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: map.getMaxZoom() });
        });
        layer.addLayer(marker);
      }
    }
  }, [venues, venueById, zoom, selected, profileId]);

  const selectedVenues = selected.map((id) => venueById.get(id)).filter((v): v is MapVenue => v !== undefined);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" role="region" aria-label="ちず" />
      {selectedVenues.length > 0 && (
        <section className="map-sheet" aria-label="えらんだ ばしょ">
          <button type="button" className="map-sheet-close" onClick={() => setSelected([])} aria-label="とじる">
            ×
          </button>
          {selectedVenues.map((v) => (
            <div key={v.place.id} className="map-sheet-venue">
              <h2 className="map-sheet-title">
                {v.place.name}
                {v.items.length > 1 && <span className="muted">（{v.items.length}けん）</span>}
              </h2>
              {v.place.position_accuracy === "approximate" && (
                <p className="muted">ちずの いちは おおよそ です</p>
              )}
              <div className="map-sheet-cards">
                {v.items.map((item: ItemCardData) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    purpose={purpose}
                    profileId={profileId}
                    profileNames={profileNames}
                    onSavedChange={onSavedChange}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function venueMarkerHtml(v: MapVenue, selected: boolean, mine: boolean): string {
  const classes = [
    "venue-marker",
    v.place.position_accuracy === "approximate" ? "is-approx" : "",
    selected ? "is-selected" : "",
  ].join(" ");
  const count = v.items.length > 1 ? `<span class="venue-count">${v.items.length}</span>` : "";
  const star = mine ? `<span class="venue-star" aria-hidden="true">★</span>` : "";
  return `<div class="${classes}"><span class="venue-pin"></span>${count}${star}</div>`;
}
