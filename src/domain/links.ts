/** 外部リンクは http(s) のみ許可する（javascript: などを画面に出さない） */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Google マップで名前・住所を検索するリンク（Maps URLs、API キー不要）。
 * 施設が同一だと確認済みのリンク（google_maps_url）とは区別して表示する。
 */
export function googleMapsSearchUrl(name: string, address: string | null): string {
  const query = address ? `${name} ${address}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const TRAVEL_MODE = { transit: "transit", car: "driving", bicycle: "bicycling" } as const;

/**
 * Google マップで行き方を調べるリンク（外部での確認用。アプリ内で時間は取得しない）。
 */
export function googleMapsDirectionsUrl(
  destination: { name: string; address: string | null; latitude: number | null; longitude: number | null },
  mode: keyof typeof TRAVEL_MODE,
): string {
  const params = new URLSearchParams({ api: "1", travelmode: TRAVEL_MODE[mode] });
  params.set(
    "destination",
    destination.latitude !== null && destination.longitude !== null
      ? `${destination.latitude},${destination.longitude}`
      : destination.address
        ? `${destination.name} ${destination.address}`
        : destination.name,
  );
  return `https://www.google.com/maps/dir/?${params}`;
}
