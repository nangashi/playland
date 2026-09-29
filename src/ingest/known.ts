/**
 * 照合用の既存データ（最小限）。お気に入り・プロフィール・家族設定・自宅の位置は含めない。
 * 収集スキル（LLM）にも、この形だけを渡す。
 */
export interface KnownData {
  places: { id: string; name: string }[];
  items: { id: string; kind: string; title: string; place_id: string | null }[];
  sources: { source_id: string; source_key: string; url: string; item_id: string | null }[];
}

export async function loadKnown(db: D1Database): Promise<KnownData> {
  const [places, items, sources] = await Promise.all([
    db.prepare(`SELECT id, name FROM places ORDER BY name, id`).all<KnownData["places"][number]>(),
    db
      .prepare(
        `SELECT id, kind, title, place_id FROM items ORDER BY created_at, id`,
      )
      .all<KnownData["items"][number]>(),
    db
      .prepare(`SELECT source_id, source_key, url, item_id FROM source_entries ORDER BY source_id, source_key`)
      .all<KnownData["sources"][number]>(),
  ]);
  return { places: places.results, items: items.results, sources: sources.results };
}
