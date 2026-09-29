import type { Candidate } from "./bundle";
import type { KnownData } from "./known";

export type MatchStatus = "new" | "existing" | "review" | "error";

export type PlaceResolution =
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string }
  | { kind: "none" };

export interface MatchResult {
  index: number;
  title: string;
  status: MatchStatus;
  reasons: string[];
  existing_item_id: string | null;
  place: PlaceResolution;
}

/** 表記ゆれを吸収した比較用の文字列（全角半角・空白・記号・大小文字） */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * 既存データと照合して、新規・既存・要確認・エラーに分ける。
 * - 出典キー（source_id + source_key）が一致すれば既存。URL だけの一致では同一としない
 * - タイトルや場所名だけの一致は自動で統合せず、要確認にする
 */
export function matchCandidates(candidates: readonly Candidate[], known: KnownData): MatchResult[] {
  const bySourceKey = new Map(known.sources.map((s) => [`${s.source_id}\u0000${s.source_key}`, s]));
  const placeIds = new Set(known.places.map((p) => p.id));
  const placesByName = new Map<string, string[]>();
  for (const p of known.places) {
    const key = normalizeName(p.name);
    placesByName.set(key, [...(placesByName.get(key) ?? []), p.id]);
  }
  const itemsByTitle = new Map<string, KnownData["items"]>();
  for (const i of known.items) {
    const key = normalizeName(i.title);
    itemsByTitle.set(key, [...(itemsByTitle.get(key) ?? []), i]);
  }

  return candidates.map((c, index) => {
    const reasons: string[] = [];
    const title = c.item.title;
    // URL だけの一致では判断しない（同じ告知ページに別の企画が載ることがある）
    const existing = bySourceKey.get(`${c.source.source_id}\u0000${c.source.source_key}`);
    if (existing) {
      return {
        index,
        title,
        status: "existing",
        reasons: ["同じ出典キーで登録済み（取り込みでは変更しません）"],
        existing_item_id: existing.item_id,
        place: { kind: "none" },
      };
    }

    let place: PlaceResolution = { kind: "none" };
    if (c.place.existing_place_id) {
      if (!placeIds.has(c.place.existing_place_id)) {
        return {
          index,
          title,
          status: "error",
          reasons: [`指定された場所 ${c.place.existing_place_id} が見つかりません`],
          existing_item_id: null,
          place,
        };
      }
      place = { kind: "existing", id: c.place.existing_place_id };
    } else if (c.place.name) {
      place = { kind: "new", name: c.place.name };
      const same = placesByName.get(normalizeName(c.place.name));
      if (same) reasons.push(`既存の場所と同じ名前です（${same.join(", ")}）。同じ場所なら existing_place_id を指定してください`);
    }

    const sameTitle = itemsByTitle.get(normalizeName(title)) ?? [];
    for (const other of sameTitle) {
      const samePlace = place.kind === "existing" && other.place_id === place.id;
      reasons.push(`同じ名前の候補があります（${other.id}${samePlace ? "・同じ場所" : ""}）。重複か確認してください`);
    }
    for (const note of c.needs_review) reasons.push(`要確認: ${note}`);

    return {
      index,
      title,
      status: reasons.length > 0 ? "review" : "new",
      reasons,
      existing_item_id: null,
      place,
    };
  });
}
