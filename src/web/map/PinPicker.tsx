import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { BASE_TILES, FALLBACK_VIEW } from "./tiles";

interface Props {
  latitude: number | null;
  longitude: number | null;
  /** 位置がまだないときの初期表示 */
  fallbackCenter: { latitude: number; longitude: number } | null;
  onChange: (latitude: number, longitude: number) => void;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** 親が地図を押す・ピンを動かして位置を直す（推測値ではなく、親が確認した位置として保存する） */
export default function PinPicker({ latitude, longitude, fallbackCenter, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { minZoom: BASE_TILES.minZoom, maxZoom: BASE_TILES.maxZoom });
    L.tileLayer(BASE_TILES.url, {
      attribution: BASE_TILES.attribution,
      minZoom: BASE_TILES.minZoom,
      maxZoom: BASE_TILES.maxZoom,
      referrerPolicy: "no-referrer",
    }).addTo(map);
    if (latitude !== null && longitude !== null) map.setView([latitude, longitude], 16);
    else if (fallbackCenter) map.setView([fallbackCenter.latitude, fallbackCenter.longitude], 13);
    else map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    map.on("click", (e: L.LeafletMouseEvent) => onChangeRef.current(round(e.latlng.lat), round(e.latlng.lng)));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 生成時の初期値だけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitude === null || longitude === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = L.marker([latitude, longitude], {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: `<div class="venue-marker is-selected"><span class="venue-pin"></span></div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 40],
        }),
      }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onChangeRef.current(round(p.lat), round(p.lng));
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([latitude, longitude]);
    }
  }, [latitude, longitude]);

  return (
    <div className="pin-picker">
      <div ref={containerRef} className="map map-small" role="application" aria-label="位置を選ぶ地図" />
      <p className="hint">地図を押すか、ピンを動かして位置を直せます。保存するまで反映されません。</p>
    </div>
  );
}
