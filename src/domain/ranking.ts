import { z } from "zod";
import type { BookmarkRecord } from "./model";
import { idSchema } from "./model";
import { searchAllEntries, searchQuerySchema, type SearchData, type SearchEntry } from "./search";

/**
 * 保存したものの家族ランキング。
 * - 対象は一覧に載る保存済みの候補だけ（非公開・「興味なし」は外す）
 * - 外した候補も順位は残し、戻ったときに元の位置に出る
 */

export const MAX_RANKING_ITEMS = 500;

export const rankingPutSchema = z.object({
  item_ids: z.array(idSchema).max(MAX_RANKING_ITEMS),
});
export type RankingPutInput = z.infer<typeof rankingPutSchema>;

const RANKING_QUERY = searchQuerySchema.parse({ saved: "true" });

export function compareBookmarks(a: BookmarkRecord, b: BookmarkRecord): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0;
}

/** ランキングに出す候補を順位順に返す */
export function rankingEntries(data: SearchData): SearchEntry[] {
  const order = new Map([...data.bookmarks].sort(compareBookmarks).map((b, i) => [b.item_id, i]));
  return searchAllEntries(data, RANKING_QUERY).sort(
    (a, b) => (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0),
  );
}

export type ReorderResult = { ok: true; order: string[] } | { ok: false };

/**
 * 画面で並べ替えた順（ランキングに出ている候補すべて）を、保存全体の順に反映する。
 * ランキングに出ていない保存は位置を変えない。出ている候補の組が一致しなければ
 * （別の端末で保存・解除された等）反映しない。
 */
export function reorderBookmarks(
  bookmarks: readonly BookmarkRecord[],
  visibleIds: readonly string[],
  requested: readonly string[],
): ReorderResult {
  const visible = new Set(visibleIds);
  if (requested.length !== visible.size || new Set(requested).size !== requested.length) return { ok: false };
  if (!requested.every((id) => visible.has(id))) return { ok: false };

  let next = 0;
  const order = [...bookmarks]
    .sort(compareBookmarks)
    .map((b) => (visible.has(b.item_id) ? requested[next++]! : b.item_id));
  return { ok: true, order };
}
