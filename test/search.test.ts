import { describe, expect, it } from "vitest";
import type { FavoriteRecord, ItemRecord } from "../src/domain/model";
import { parseSearchQuery, searchItems, type SearchQuery } from "../src/domain/search";

function item(id: string, created_at: string, overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id,
    kind: "spot",
    place_id: "pl",
    title: id,
    child_description: null,
    rain_policy: "unknown",
    publish_status: "published",
    official_url: null,
    created_at,
    ...overrides,
  };
}

const items = [
  item("a", "2026-09-01T00:00:00.000Z"),
  item("b", "2026-09-03T00:00:00.000Z"),
  item("c", "2026-09-02T00:00:00.000Z"),
  item("d", "2026-09-02T00:00:00.000Z"),
  item("draft", "2026-09-09T00:00:00.000Z", { publish_status: "draft" }),
  item("hidden", "2026-09-09T00:00:00.000Z", { publish_status: "hidden" }),
];
const favorites: FavoriteRecord[] = [
  { profile_id: "p1", item_id: "a", created_at: "2026-09-10T00:00:00.000Z" },
  { profile_id: "p2", item_id: "c", created_at: "2026-09-10T00:00:00.000Z" },
  { profile_id: "p1", item_id: "hidden", created_at: "2026-09-10T00:00:00.000Z" },
];
const q = (over: Partial<SearchQuery>): SearchQuery => ({ favorites: "all", limit: 30, offset: 0, ...over });
const ids = (r: { items: ItemRecord[] }) => r.items.map((i) => i.id);

describe("searchItems", () => {
  it("公開中の候補だけを新着順・同時刻は ID 順で返す", () => {
    expect(ids(searchItems(items, favorites, q({})))).toEqual(["b", "c", "d", "a"]);
  });

  it("favorites=mine は選択プロフィールの保存だけ", () => {
    expect(ids(searchItems(items, favorites, q({ favorites: "mine", profile_id: "p1" })))).toEqual(["a"]);
    expect(ids(searchItems(items, favorites, q({ favorites: "mine", profile_id: "p3" })))).toEqual([]);
  });

  it("favorites=family は家族の誰かの保存", () => {
    expect(ids(searchItems(items, favorites, q({ favorites: "family" })))).toEqual(["c", "a"]);
  });

  it("ページ分割しても total は全件数", () => {
    const r = searchItems(items, favorites, q({ limit: 2, offset: 2 }));
    expect(ids(r)).toEqual(["d", "a"]);
    expect(r.total).toBe(4);
  });
});

describe("parseSearchQuery", () => {
  it("既定値を補う", () => {
    const r = parseSearchQuery(new URLSearchParams(""));
    expect(r.success && r.data).toEqual({ favorites: "all", limit: 30, offset: 0 });
  });

  it("mine に profile_id がなければ拒否", () => {
    expect(parseSearchQuery(new URLSearchParams("favorites=mine")).success).toBe(false);
  });

  it("未定義の値や範囲外は拒否し、黙って既定値に置き換えない", () => {
    expect(parseSearchQuery(new URLSearchParams("favorites=everything")).success).toBe(false);
    expect(parseSearchQuery(new URLSearchParams("limit=0")).success).toBe(false);
    expect(parseSearchQuery(new URLSearchParams("limit=101")).success).toBe(false);
    expect(parseSearchQuery(new URLSearchParams("profile_id=../x")).success).toBe(false);
  });
});
