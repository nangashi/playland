import { homeDistanceKm } from "../src/domain/trip";
import { describe, expect, it } from "vitest";
import { parseSearchQuery, searchItems, type SearchResult } from "../src/domain/search";
import { data, estimate, makeItem, pref, query } from "./factories";

const ids = (r: SearchResult) => r.entries.map((e) => e.item.id);

describe("公開状態・保存・並び順", () => {
  const items = [
    makeItem("a", { created_at: "2026-09-01T00:00:00.000Z" }),
    makeItem("b", { created_at: "2026-09-03T00:00:00.000Z" }),
    makeItem("c", { created_at: "2026-09-02T00:00:00.000Z" }),
    makeItem("d", { created_at: "2026-09-02T00:00:00.000Z" }),
    makeItem("draft", { publish_status: "draft", created_at: "2026-09-09T00:00:00.000Z" }),
    makeItem("hidden", { publish_status: "hidden", created_at: "2026-09-09T00:00:00.000Z" }),
    // イベントは次のフェーズまで対象外
    makeItem("event", { kind: "event", created_at: "2026-09-09T00:00:00.000Z" }),
  ];
  const bookmarks = [
    { item_id: "a", created_at: "2026-09-10T00:00:00.000Z", rank: 1 },
    { item_id: "hidden", created_at: "2026-09-10T00:00:00.000Z", rank: 2 },
  ];
  const d = data({ items, bookmarks });

  it("公開中の常設スポットだけを新着順・同時刻は ID 順で返す", () => {
    expect(ids(searchItems(d, query()))).toEqual(["b", "c", "d", "a"]);
  });

  it("保存済みだけに絞れる（家族で共有・A03）", () => {
    const r = searchItems(d, query({ saved: "true" }));
    expect(ids(r)).toEqual(["a"]);
    expect(r.entries[0]?.saved).toBe(true);
  });

  it("ページ分割しても total は全件数", () => {
    const r = searchItems(d, query({ limit: 2, offset: 2 }));
    expect(ids(r)).toEqual(["d", "a"]);
    expect(r.total).toBe(4);
  });
});

describe("興味なし", () => {
  const d = data({
    items: [
      makeItem("a", { created_at: "2026-09-03T00:00:00.000Z" }),
      makeItem("b", { created_at: "2026-09-02T00:00:00.000Z" }),
      makeItem("c", { created_at: "2026-09-01T00:00:00.000Z" }),
    ],
    hidden: [{ item_id: "a", created_at: "2026-09-10T00:00:00.000Z" }],
    bookmarks: [{ item_id: "a", created_at: "2026-09-10T00:00:00.000Z", rank: 1 }],
  });

  it("既定では出さず、保存済みでも出さない", () => {
    expect(ids(searchItems(d, query()))).toEqual(["b", "c"]);
    expect(ids(searchItems(d, query({ saved: "true" })))).toEqual([]);
  });

  it("「興味なしも表示」のときだけ、印を付けて最後に出す", () => {
    const r = searchItems(d, query({ include_hidden: "true" }));
    expect(ids(r)).toEqual(["b", "c", "a"]);
    expect(r.entries.map((e) => e.hidden)).toEqual([false, false, true]);
  });
});

describe("雨の日でも遊べる（A04）", () => {
  const d = data({
    items: [
      makeItem("ok", { rain_policy: "ok" }),
      makeItem("cond", { rain_policy: "conditional" }),
      makeItem("ng", { rain_policy: "not_suitable" }),
      makeItem("unk", { rain_policy: "unknown" }),
    ],
  });

  it("根拠のある ok だけ。条件付きは含めない", () => {
    expect(ids(searchItems(d, query({ rain: "ok" })))).toEqual(["ok"]);
  });

  it("不明を含めても ok 扱いにせず、理由付きで後ろに出す。不向き・条件付きは戻さない", () => {
    const r = searchItems(d, query({ rain: "ok", include_unknown: "true" }));
    expect(ids(r)).toEqual(["ok", "unk"]);
    expect(r.entries[1]?.unknown).toEqual(["rain"]);
  });
});

describe("カテゴリ（含まれるタグのどれかに当てはまれば一致）", () => {
  const assessed = { facility_tags_status: "assessed", experience_tags_status: "assessed" } as const;
  const d = data({
    items: [
      makeItem("zoo", assessed),
      makeItem("insects-park", assessed),
      makeItem("museum", assessed),
      makeItem("farm-unassessed-exp", { facility_tags_status: "assessed", experience_tags_status: "unassessed" }),
      makeItem("all-unassessed"),
    ],
    itemTags: [
      { item_id: "zoo", tag_id: "zoo" },
      { item_id: "insects-park", tag_id: "park" },
      { item_id: "insects-park", tag_id: "insects" },
      { item_id: "museum", tag_id: "museum" },
      { item_id: "farm-unassessed-exp", tag_id: "park" },
    ],
  });

  it("施設分類と体験をまたいで、どれかに当てはまれば一致", () => {
    expect(ids(searchItems(d, query({ category: "animals" }))).sort()).toEqual(["insects-park", "zoo"]);
  });

  it("未判定は該当なしと区別し、不明として扱う", () => {
    const r = searchItems(d, query({ category: "animals", include_unknown: "true" }));
    expect(r.entries.find((e) => e.item.id === "farm-unassessed-exp")?.unknown).toEqual(["category"]);
    expect(r.entries.find((e) => e.item.id === "all-unassessed")?.unknown).toEqual(["category"]);
    // 判定済みで該当なしは不一致
    expect(ids(r)).not.toContain("museum");
  });
});

describe("移動（A08・A09・A10）", () => {
  const settings = { origin_version: 2, bicycle_max_minutes: 20 };
  const place = (id: string) => `pl-${id}`;
  const d = data({
    settings,
    items: ["bike20", "bike21", "bike-unknown", "bike-stale", "car-driving", "car-door", "no-route", "hidden-transit", "no-place"].map(
      (id) => makeItem(id, id === "no-place" ? { place_id: null } : {}),
    ),
    estimates: [
      estimate(place("bike20"), "bicycle", { origin_version: 2, minutes: 20 }),
      estimate(place("bike21"), "bicycle", { origin_version: 2, minutes: 21 }),
      estimate(place("bike-stale"), "bicycle", { origin_version: 1, minutes: 10 }),
      estimate(place("car-driving"), "car", { origin_version: 2, minutes: 35, basis: "driving_only" }),
      estimate(place("car-door"), "car", { origin_version: 2, minutes: 50 }),
      estimate(place("car-door"), "transit", { origin_version: 2, minutes: 90 }),
      estimate(place("no-route"), "transit", { origin_version: 2, route_status: "no_route", minutes: null, basis: null }),
      estimate(place("no-route"), "car", { origin_version: 2, route_status: "no_route", minutes: null, basis: null }),
    ],
    preferences: [pref(place("hidden-transit"), "transit", "hide"), pref(place("hidden-transit"), "car", "hide")],
  });

  it("公共交通と車は既定で表示し、親が非表示にできる（A08）", () => {
    const r = searchItems(d, query());
    const views = r.entries.find((e) => e.item.id === "bike-unknown")?.travel;
    expect(views?.filter((v) => v.visible).map((v) => v.mode)).toEqual(["transit", "car"]);
    const hidden = r.entries.find((e) => e.item.id === "hidden-transit")?.travel;
    expect(hidden?.filter((v) => v.visible).map((v) => v.mode)).toEqual([]);
  });

  it("自転車は 20 分以内の有効な値があるときだけ。21 分・不明・古い出発地点は一致しない（A09）", () => {
    expect(ids(searchItems(d, query({ modes: "bicycle" })))).toEqual(["bike20"]);
    const withUnknown = searchItems(d, query({ modes: "bicycle", include_unknown: "true" }));
    expect(ids(withUnknown)).not.toContain("bike21");
    expect(ids(withUnknown)).not.toContain("bike-stale");
    const stale = searchItems(d, query()).entries.find((e) => e.item.id === "bike-stale");
    expect(stale?.travel?.find((v) => v.mode === "bicycle")).toMatchObject({ visible: false, stale_only: true });
  });

  it("運転時間だけでは自宅からの時間の条件を通さない（A10）", () => {
    expect(ids(searchItems(d, query({ modes: "car", max_minutes: "60" })))).toEqual(["car-door"]);
    const withUnknown = searchItems(d, query({ modes: "car", max_minutes: "60", include_unknown: "true" }));
    expect(withUnknown.entries.find((e) => e.item.id === "car-driving")?.unknown).toEqual(["travel"]);
  });

  it("経路なし（確認済み）と未取得を区別する（A10）", () => {
    const r = searchItems(d, query({ modes: "transit,car", max_minutes: "60", include_unknown: "true" }));
    expect(ids(r)).not.toContain("no-route");
    expect(r.entries.find((e) => e.item.id === "bike-unknown")?.unknown).toEqual(["travel"]);
  });

  it("車でしか条件を満たさない場合は一致した手段で分かる", () => {
    const r = searchItems(d, query({ modes: "transit,car", max_minutes: "60" }));
    expect(r.entries.find((e) => e.item.id === "car-door")?.matched_modes).toEqual(["car"]);
  });

  it("場所不明の候補は移動条件では不明扱い", () => {
    const r = searchItems(d, query({ modes: "transit", include_unknown: "true" }));
    expect(r.entries.find((e) => e.item.id === "no-place")?.unknown).toEqual(["travel"]);
    expect(ids(searchItems(d, query({ modes: "transit" })))).not.toContain("no-place");
  });

  it("親の値を経路サービスの値より優先する", () => {
    const d2 = data({
      settings,
      items: [makeItem("x")],
      estimates: [
        estimate("pl-x", "transit", { origin_version: 2, source: "api", minutes: 80 }),
        estimate("pl-x", "transit", { origin_version: 2, source: "manual", minutes: 45 }),
      ],
    });
    const views = searchItems(d2, query()).entries[0]?.travel;
    expect(views?.find((v) => v.mode === "transit")?.estimate).toMatchObject({ minutes: 45, source: "manual" });
  });
});

describe("parseSearchQuery", () => {
  it("既定値を補う", () => {
    const r = parseSearchQuery(new URLSearchParams(""));
    expect(r.success && r.data).toEqual({
      saved: false,
      rain: "any",
      include_unknown: false,
      include_hidden: false,
      limit: 30,
      offset: 0,
    });
  });

  it("未定義の値は拒否し、黙って既定値に置き換えない", () => {
    for (const q of [
      "saved=yes",
      "limit=0",
      "limit=101",
      "category=not_a_category",
      "modes=plane",
      "include_unknown=yes",
      "include_hidden=1",
      "rain=ok_or_conditional",
      "max_minutes=0",
    ]) {
      expect(parseSearchQuery(new URLSearchParams(q)).success, q).toBe(false);
    }
  });

  it("移動手段はカンマ区切りを重複なしで受け取る", () => {
    const r = parseSearchQuery(new URLSearchParams("modes=car,bicycle,car"));
    expect(r.success && r.data.modes).toEqual(["car", "bicycle"]);
  });
});

describe("日帰り・旅行（場所に保存した自宅からの距離）", () => {
  const d = data({
    items: ["near", "edge", "far", "no-distance", "no-place"].map((id) =>
      makeItem(id, id === "no-place" ? { place_id: null } : {}),
    ),
    places: [
      { id: "pl-near", home_distance_km: 12.3 },
      { id: "pl-edge", home_distance_km: 100 },
      { id: "pl-far", home_distance_km: 150.2 },
      { id: "pl-no-distance", home_distance_km: null },
    ],
  });

  it("100km 以内は日帰り、それより遠いと旅行", () => {
    const r = searchItems(d, query());
    expect(Object.fromEntries(r.entries.map((e) => [e.item.id, e.trip]))).toEqual({
      near: "day_trip",
      edge: "day_trip",
      far: "trip",
      "no-distance": null,
      "no-place": null,
    });
    expect(ids(searchItems(d, query({ trip: "day_trip" }))).sort()).toEqual(["edge", "near"]);
    expect(ids(searchItems(d, query({ trip: "trip" })))).toEqual(["far"]);
  });

  it("距離がなければ不明扱い（わからないものも見るときだけ出す）", () => {
    const r = searchItems(d, query({ trip: "day_trip", include_unknown: "true" }));
    expect(ids(r)).not.toContain("far");
    expect(r.entries.find((e) => e.item.id === "no-distance")?.unknown).toEqual(["trip"]);
    expect(r.entries.find((e) => e.item.id === "no-place")?.unknown).toEqual(["trip"]);
  });
});

describe("自宅からの距離", () => {
  const home = { latitude: 35.68, longitude: 139.76 };
  it("座標から小数 1 桁の km で求め、座標がなければ null", () => {
    // 北へ緯度 1 度 ≒ 111.2km
    expect(homeDistanceKm({ latitude: 36.68, longitude: 139.76 }, home)).toBe(111.2);
    expect(homeDistanceKm({ latitude: null, longitude: null }, home)).toBeNull();
    expect(homeDistanceKm({ latitude: 36.68, longitude: 139.76 }, null)).toBeNull();
  });
});
