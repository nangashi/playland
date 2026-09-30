import { z } from "zod";

/**
 * 住所から座標を取得する（住所検索サービスの結果を使う。LLM に座標を推測させない）。
 * - 座標がまだなく、親が指定・消去していない場所だけが対象
 * - 住所検索の代表点は施設の正確な地点とは限らないので、精度は approximate として保存する
 * - 検索結果の住所が問い合わせの住所の先頭と一致しない場合は採用しない
 */

export interface GeocodeCandidate {
  latitude: number;
  longitude: number;
  /** 検索サービスが返した住所 */
  title: string;
}

export type Geocoder = (query: string) => Promise<GeocodeCandidate[]>;

const gsiResponseSchema = z.array(
  z.object({
    geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
    properties: z.object({ title: z.string() }),
  }),
);

/** 国土地理院 住所検索 API（https://msearch.gsi.go.jp/address-search/AddressSearch） */
export function gsiGeocoder(fetchFn: typeof fetch = fetch): Geocoder {
  return async (query) => {
    const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`住所検索が失敗しました（HTTP ${res.status}）`);
    const parsed = gsiResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("住所検索の応答が想定外の形式です");
    return parsed.data.map((f) => ({
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
      title: f.properties.title,
    }));
  };
}

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function kanjiNumber(s: string): string {
  // 一〜九十九までの漢数字を算用数字に
  const m = s.match(/^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/);
  if (!m || s === "") return s;
  const tens = m[2] ? (m[1] ? KANJI_DIGITS[m[1]]! : 1) : 0;
  const ones = m[2] ? (m[3] ? KANJI_DIGITS[m[3]]! : 0) : m[1] ? KANJI_DIGITS[m[1]]! : 0;
  return String(tens * 10 + ones);
}

/** 検索に使う住所：複数の住所の最初の 1 つ、括弧書き・建物名・フロアを除く */
export function addressForQuery(address: string): string {
  let a = address.normalize("NFKC").trim();
  a = a.split(/[、,]/)[0]!;
  a = a.replace(/[（(].*?[）)]/g, "");
  a = a.split(/\s+/)[0]!;
  // 「二・四丁目」のような複数の丁目は最初の丁目だけにする
  a = a.replace(/([一二三四五六七八九十0-9]+)[・･][一二三四五六七八九十0-9]+丁目/, "$1丁目");
  return a;
}

const PREFECTURE = /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/;

/** 比較用：都道府県を除き、丁目・番地・号をハイフン区切りの算用数字にそろえる */
export function normalizeAddress(address: string): string {
  return addressForQuery(address)
    .replace(PREFECTURE, "")
    .replace(/([一二三四五六七八九十]+)(?=丁目|番|号)/g, (d) => kanjiNumber(d))
    .replace(/丁目/g, "-")
    .replace(/番地?/g, "-")
    .replace(/号/g, "")
    .replace(/[‐－―ー−]/g, "-")
    .replace(/-+$/g, "")
    .replace(/\s/g, "");
}

/** 市区町村（政令市の区を含む）の部分 */
function municipality(normalized: string): string {
  return normalized.match(/^(.+?市.+?区|.+?[市区町村])/)?.[1] ?? normalized;
}

/**
 * 検索結果のうち、問い合わせの住所の先頭と一致する最初のものを採用する。
 * 市区町村だけの一致（町名以下が合わない）は採用しない。
 */
export function pickCandidate(query: string, candidates: readonly GeocodeCandidate[]): GeocodeCandidate | null {
  const q = normalizeAddress(query);
  const muni = municipality(q);
  for (const c of candidates) {
    const t = normalizeAddress(c.title);
    if (t.length <= muni.length || !q.startsWith(t)) continue;
    // 「町5」が「町50-…」に一致しないよう、数字の途中で切れた一致は採用しない
    const next = q.charAt(t.length);
    if (/\d$/.test(t) && /\d/.test(next)) continue;
    return c;
  }
  return null;
}

export interface GeocodeOutcome {
  place_id: string;
  name: string;
  address: string;
  query: string;
  status: "found" | "not_found" | "error";
  latitude: number | null;
  longitude: number | null;
  matched: string | null;
  error: string | null;
  applied: boolean;
}

export interface GeocodeOptions {
  apply: boolean;
  now?: () => Date;
  /** 問い合わせの間隔（サービスへの負荷を抑える） */
  delayMs?: number;
  limit?: number;
}

export async function geocodePlaces(db: D1Database, geocoder: Geocoder, options: GeocodeOptions): Promise<GeocodeOutcome[]> {
  const now = options.now ?? (() => new Date());
  const { results } = await db
    .prepare(
      `SELECT id, name, address_text FROM places
        WHERE latitude IS NULL AND position_source IS NULL AND address_text IS NOT NULL
        ORDER BY name, id LIMIT ?`,
    )
    .bind(options.limit ?? 100)
    .all<{ id: string; name: string; address_text: string }>();

  const outcomes: GeocodeOutcome[] = [];
  for (const [i, place] of results.entries()) {
    if (i > 0 && options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    const query = addressForQuery(place.address_text);
    const base = { place_id: place.id, name: place.name, address: place.address_text, query };
    let picked: GeocodeCandidate | null;
    try {
      picked = pickCandidate(query, await geocoder(query));
    } catch (err) {
      outcomes.push({
        ...base,
        status: "error",
        latitude: null,
        longitude: null,
        matched: null,
        error: err instanceof Error ? err.message : String(err),
        applied: false,
      });
      continue;
    }
    if (!picked) {
      outcomes.push({ ...base, status: "not_found", latitude: null, longitude: null, matched: null, error: null, applied: false });
      continue;
    }
    let applied = false;
    if (options.apply) {
      // 座標がまだなく、親が触っていない場合だけ書き込む（途中で親が指定したら上書きしない）
      const res = await db
        .prepare(
          `UPDATE places
              SET latitude = ?, longitude = ?, position_accuracy = 'approximate',
                  position_source = 'geocoder', position_note = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND latitude IS NULL AND position_source IS NULL`,
        )
        .bind(picked.latitude, picked.longitude, `国土地理院 住所検索: ${picked.title}`, now().toISOString(), place.id)
        .run();
      applied = (res.meta.changes ?? 0) > 0;
    }
    outcomes.push({
      ...base,
      status: "found",
      latitude: picked.latitude,
      longitude: picked.longitude,
      matched: picked.title,
      error: null,
      applied,
    });
  }
  return outcomes;
}
