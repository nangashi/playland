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
