import { describe, expect, it } from "vitest";
import type { FavoriteRecord } from "../src/domain/model";
import { tokyoDate } from "../src/domain/schedule";
import { parseSearchQuery, searchItems, type SearchResult } from "../src/domain/search";
import { data, estimate, makeEvent, makeItem, occ, pref, query } from "./factories";

// 2026-10-05 12:00 JST
const NOW = new Date("2026-10-05T03:00:00.000Z");
const ids = (r: SearchResult) => r.entries.map((e) => e.item.id);

describe("保存状態と並び順", () => {
  const items = [
    makeItem("a", { created_at: "2026-09-01T00:00:00.000Z" }),
    makeItem("b", { created_at: "2026-09-03T00:00:00.000Z" }),
    makeItem("c", { created_at: "2026-09-02T00:00:00.000Z" }),
    makeItem("d", { created_at: "2026-09-02T00:00:00.000Z" }),
    makeItem("draft", { publish_status: "draft", created_at: "2026-09-09T00:00:00.000Z" }),
    makeItem("hidden", { publish_status: "hidden", created_at: "2026-09-09T00:00:00.000Z" }),
  ];
  const favorites: FavoriteRecord[] = [
    { profile_id: "p1", item_id: "a", created_at: "2026-09-10T00:00:00.000Z" },
    { profile_id: "p2", item_id: "c", created_at: "2026-09-10T00:00:00.000Z" },
    { profile_id: "p1", item_id: "hidden", created_at: "2026-09-10T00:00:00.000Z" },
  ];
  const d = data({ items, favorites });

  it("公開中の候補だけを新着順・同時刻は ID 順で返す", () => {
    expect(ids(searchItems(d, query(), NOW))).toEqual(["b", "c", "d", "a"]);
  });

  it("mine は選択プロフィール、family は家族の誰かの保存（A03）", () => {
    expect(ids(searchItems(d, query({ favorites: "mine", profile_id: "p1" }), NOW))).toEqual(["a"]);
    expect(ids(searchItems(d, query({ favorites: "family" }), NOW))).toEqual(["c", "a"]);
  });

  it("ページ分割しても total は全件数", () => {
    const r = searchItems(d, query({ limit: 2, offset: 2 }), NOW);
    expect(ids(r)).toEqual(["d", "a"]);
    expect(r.total).toBe(4);
  });
});

describe("日本時間の当日（A06）", () => {
  it("UTC では前日でも、日本時間で当日なら今日", () => {
    expect(tokyoDate(new Date("2026-10-09T15:30:00.000Z"))).toBe("2026-10-10");
    expect(tokyoDate(new Date("2026-10-10T14:59:59.000Z"))).toBe("2026-10-10");
    expect(tokyoDate(new Date("2026-10-10T15:00:00.000Z"))).toBe("2026-10-11");
  });

  it("日本時間 0:30 に、その日の開催を今日の候補にする", () => {
    const d = data({ items: [makeEvent("e")], occurrences: [occ("e", "2026-10-10")] });
    const r = searchItems(d, query({ purpose: "today" }), new Date("2026-10-09T15:30:00.000Z"));
    expect(ids(r)).toEqual(["e"]);
  });
});

describe("今日／そのうち と複数開催日", () => {
  const items = [
    makeItem("spot"),
    // 離れた 2 日だけの開催。間の日を開催日と解釈しない
    makeEvent("split"),
    makeEvent("today-date"),
    // 今日の回が時刻付きで、すでに終わっている
    makeEvent("today-finished"),
    makeEvent("today-finished-with-future"),
    makeEvent("today-later"),
    makeEvent("unknown", { schedule_status: "unknown" }),
    makeEvent("ended"),
    makeEvent("cancelled"),
    makeEvent("range"),
  ];
  const occurrences = [
    occ("split", "2026-10-01"),
    occ("split", "2026-10-10"),
    occ("today-date", "2026-10-05"),
    occ("today-finished", "2026-10-05", "2026-10-05", {
      precision: "datetime",
      starts_at: "2026-10-05T01:00:00.000Z",
      ends_at: "2026-10-05T02:00:00.000Z",
    }),
    occ("today-finished-with-future", "2026-10-05", "2026-10-05", {
      precision: "datetime",
      starts_at: "2026-10-05T01:00:00.000Z",
      ends_at: "2026-10-05T02:00:00.000Z",
    }),
    occ("today-finished-with-future", "2026-10-12"),
    occ("today-later", "2026-10-05", "2026-10-05", {
      precision: "datetime",
      starts_at: "2026-10-05T05:00:00.000Z",
      ends_at: "2026-10-05T06:00:00.000Z",
    }),
    occ("ended", "2026-09-20"),
    occ("cancelled", "2026-10-05", "2026-10-05", { status: "cancelled" }),
    occ("range", "2026-10-01", "2026-10-31"),
  ];
  const d = data({ items, occurrences });

  it("今日：常設・今日開催（日付のみ・これからの回・期間中）だけ", () => {
    expect(ids(searchItems(d, query({ purpose: "today" }), NOW)).sort()).toEqual(
      ["range", "spot", "today-date", "today-later"].sort(),
    );
  });

  it("今日：離れた開催日の間の日は開催としない", () => {
    const r = searchItems(d, query({ purpose: "today" }), NOW);
    expect(ids(r)).not.toContain("split");
    const split = searchItems(d, query(), NOW).entries.find((e) => e.item.id === "split");
    expect(split?.schedule).toMatchObject({ state: "upcoming", next_date: "2026-10-10" });
  });

  it("今日：時刻が分かり全回が終わったものは外し、次回があれば upcoming", () => {
    const all = searchItems(d, query(), NOW).entries;
    expect(all.find((e) => e.item.id === "today-finished-with-future")?.schedule.state).toBe("upcoming");
    expect(ids(searchItems(d, query({ purpose: "today" }), NOW))).not.toContain("today-finished");
  });

  it("今日：開催日不明は今日開催と断定せず、不明を含めるときだけ理由付きで出す", () => {
    expect(ids(searchItems(d, query({ purpose: "today" }), NOW))).not.toContain("unknown");
    const r = searchItems(d, query({ purpose: "today", include_unknown: "true" }), NOW);
    const entry = r.entries.find((e) => e.item.id === "unknown");
    expect(entry?.unknown).toEqual(["schedule"]);
    // 不明を含む候補は一致した候補の後ろ
    expect(r.entries.at(-1)?.item.id).toBe("unknown");
  });

  it("そのうち：日程で狭めないが、終了・中止は通常の発見から外す（A07）", () => {
    const r = ids(searchItems(d, query(), NOW));
    expect(r).toContain("unknown");
    expect(r).toContain("split");
    expect(r).not.toContain("ended");
    expect(r).not.toContain("cancelled");
    expect(r).not.toContain("today-finished");
  });

  it("お気に入りでは終了済みも履歴として最後に出す（A07）", () => {
    const favorites = ["ended", "split"].map((item_id) => ({
      profile_id: "p1",
      item_id,
      created_at: "2026-09-01T00:00:00.000Z",
    }));
    const r = searchItems({ ...d, favorites }, query({ favorites: "mine", profile_id: "p1" }), NOW);
    expect(ids(r)).toEqual(["split", "ended"]);
    expect(r.entries[1]?.finished).toBe(true);
    // 明示的に外すこともできる
    const hidden = searchItems(
      { ...d, favorites },
      query({ favorites: "mine", profile_id: "p1", include_ended: "false" }),
      NOW,
    );
    expect(ids(hidden)).toEqual(["split"]);
  });
});

describe("雨（A04）", () => {
  const d = data({
    items: [
      makeItem("ok", { rain_policy: "ok" }),
      makeItem("cond", { rain_policy: "conditional" }),
      makeItem("ng", { rain_policy: "not_suitable" }),
      makeItem("unk", { rain_policy: "unknown" }),
    ],
  });

  it("「雨でも遊べる」の厳密な条件は ok だけ", () => {
    expect(ids(searchItems(d, query({ rain: "ok" }), NOW))).toEqual(["ok"]);
  });

  it("条件付きを含める選択", () => {
    expect(ids(searchItems(d, query({ rain: "ok_or_conditional" }), NOW)).sort()).toEqual(["cond", "ok"]);
  });

  it("不明を含めても ok 扱いにせず、理由付きで後ろに出す。不向きは戻さない", () => {
    const r = searchItems(d, query({ rain: "ok", include_unknown: "true" }), NOW);
    expect(ids(r)).toEqual(["ok", "unk"]);
    expect(r.entries[1]?.unknown).toEqual(["rain"]);
  });
});

describe("年齢の参加資格（A05）", () => {
  const d = data({
    items: [
      makeItem("6plus", { age_min_kind: "value", age_min: 6, age_max_kind: "none" }),
      makeItem("6plus-max-unstated", { age_min_kind: "value", age_min: 6, age_max_kind: "unknown" }),
      makeItem("any-age", { age_min_kind: "none", age_max_kind: "none" }),
      makeItem("unknown"),
      makeItem("3to5", { age_min_kind: "value", age_min: 3, age_max_kind: "value", age_max: 5 }),
      // おすすめ年齢は参加資格として使わない
      makeItem("recommended-only", { recommended_age_min: 7, recommended_age_max: 9 }),
    ],
  });

  it("参加資格が確認できたものだけが一致", () => {
    expect(ids(searchItems(d, query({ age: 7 }), NOW)).sort()).toEqual(["6plus", "any-age"]);
  });

  it("上限の記載なしは「制限なし」と扱わず不明", () => {
    const r = searchItems(d, query({ age: 7, include_unknown: "true" }), NOW);
    expect(r.entries.find((e) => e.item.id === "6plus-max-unstated")?.unknown).toEqual(["age"]);
    expect(r.entries.find((e) => e.item.id === "recommended-only")?.unknown).toEqual(["age"]);
  });

  it("既知の対象外は不明を含めても戻さない", () => {
    const r = searchItems(d, query({ age: 7, include_unknown: "true" }), NOW);
    expect(ids(r)).not.toContain("3to5");
    expect(ids(searchItems(d, query({ age: 4 }), NOW))).toEqual(["3to5", "any-age"]);
  });
});

describe("タグ（同じ分類内は OR、分類間は AND）", () => {
  const d = data({
    items: [
      makeItem("park-climb", { facility_tags_status: "assessed", experience_tags_status: "assessed" }),
      makeItem("park-insects", { facility_tags_status: "assessed", experience_tags_status: "assessed" }),
      makeItem("museum-climb", { facility_tags_status: "assessed", experience_tags_status: "assessed" }),
      makeItem("park-unassessed", { facility_tags_status: "assessed", experience_tags_status: "unassessed" }),
    ],
    itemTags: [
      { item_id: "park-climb", tag_id: "park" },
      { item_id: "park-climb", tag_id: "climbing" },
      { item_id: "park-insects", tag_id: "park" },
      { item_id: "park-insects", tag_id: "insects" },
      { item_id: "museum-climb", tag_id: "museum" },
      { item_id: "museum-climb", tag_id: "climbing" },
      { item_id: "park-unassessed", tag_id: "park" },
    ],
  });

  it("体験タグ同士は OR", () => {
    const r = searchItems(d, query({ tag_ids: "climbing,insects" }), NOW);
    expect(ids(r).sort()).toEqual(["museum-climb", "park-climb", "park-insects"]);
  });

  it("施設分類と体験は AND", () => {
    const r = searchItems(d, query({ tag_ids: "park,climbing,athletic" }), NOW);
    expect(ids(r)).toEqual(["park-climb"]);
  });

  it("未判定は該当なしと区別し、不明として扱う", () => {
    const r = searchItems(d, query({ tag_ids: "park,climbing", include_unknown: "true" }), NOW);
    expect(r.entries.find((e) => e.item.id === "park-unassessed")?.unknown).toEqual(["tags"]);
    // 判定済みで該当なしは不一致
    expect(ids(r)).not.toContain("park-insects");
  });
});

describe("移動（A08・A09・A10）", () => {
  const settings = { origin_version: 2, bicycle_max_minutes: 20 };
  const place = (id: string) => `pl-${id}`;
  const d = data({
    settings,
    items: ["bike20", "bike21", "bike-unknown", "bike-stale", "car-driving", "car-door", "no-route", "hidden-transit", "no-place"].map(
      (id) => makeItem(id, id === "no-place" ? { kind: "event", place_id: null } : {}),
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
    const r = searchItems(d, query(), NOW);
    const views = r.entries.find((e) => e.item.id === "bike-unknown")?.travel;
    expect(views?.filter((v) => v.visible).map((v) => v.mode)).toEqual(["transit", "car"]);
    const hidden = r.entries.find((e) => e.item.id === "hidden-transit")?.travel;
    expect(hidden?.filter((v) => v.visible).map((v) => v.mode)).toEqual([]);
  });

  it("自転車は 20 分以内の有効な値があるときだけ。21 分・不明・古い出発地点は一致しない（A09）", () => {
    const r = searchItems(d, query({ modes: "bicycle" }), NOW);
    expect(ids(r)).toEqual(["bike20"]);
    const withUnknown = searchItems(d, query({ modes: "bicycle", include_unknown: "true" }), NOW);
    expect(ids(withUnknown)).not.toContain("bike21");
    expect(ids(withUnknown)).not.toContain("bike-stale");
    const stale = searchItems(d, query(), NOW).entries.find((e) => e.item.id === "bike-stale");
    expect(stale?.travel?.find((v) => v.mode === "bicycle")).toMatchObject({ visible: false, stale_only: true });
  });

  it("運転時間だけでは自宅からの時間の条件を通さない（A10）", () => {
    const r = searchItems(d, query({ modes: "car", max_minutes: "60" }), NOW);
    expect(ids(r)).toEqual(["car-door"]);
    const withUnknown = searchItems(d, query({ modes: "car", max_minutes: "60", include_unknown: "true" }), NOW);
    expect(withUnknown.entries.find((e) => e.item.id === "car-driving")?.unknown).toEqual(["travel"]);
  });

  it("経路なし（確認済み）と未取得を区別する（A10）", () => {
    const r = searchItems(d, query({ modes: "transit,car", max_minutes: "60", include_unknown: "true" }), NOW);
    expect(ids(r)).not.toContain("no-route");
    expect(r.entries.find((e) => e.item.id === "bike-unknown")?.unknown).toEqual(["travel"]);
  });

  it("車でしか条件を満たさない場合は一致した手段で分かる", () => {
    const r = searchItems(d, query({ modes: "transit,car", max_minutes: "60" }), NOW);
    expect(r.entries.find((e) => e.item.id === "car-door")?.matched_modes).toEqual(["car"]);
  });

  it("会場不明の候補は移動条件では不明扱い", () => {
    const r = searchItems(d, query({ modes: "transit", include_unknown: "true" }), NOW);
    expect(r.entries.find((e) => e.item.id === "no-place")?.unknown).toEqual(["travel"]);
    expect(ids(searchItems(d, query({ modes: "transit" }), NOW))).not.toContain("no-place");
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
    const views = searchItems(d2, query(), NOW).entries[0]?.travel;
    expect(views?.find((v) => v.mode === "transit")?.estimate).toMatchObject({ minutes: 45, source: "manual" });
  });
});

describe("parseSearchQuery", () => {
  it("既定値を補う", () => {
    const r = parseSearchQuery(new URLSearchParams(""));
    expect(r.success && r.data).toEqual({
      purpose: "someday",
      favorites: "all",
      rain: "any",
      include_unknown: false,
      limit: 30,
      offset: 0,
    });
  });

  it("未定義の値は拒否し、黙って既定値に置き換えない", () => {
    for (const q of [
      "favorites=mine",
      "favorites=everything",
      "limit=0",
      "limit=101",
      "profile_id=../x",
      "tag_ids=not_a_tag",
      "modes=plane",
      "include_unknown=yes",
      "rain=maybe",
      "purpose=tomorrow",
      "max_minutes=0",
    ]) {
      expect(parseSearchQuery(new URLSearchParams(q)).success, q).toBe(false);
    }
  });

  it("カンマ区切りの一覧を重複なしで受け取る", () => {
    const r = parseSearchQuery(new URLSearchParams("tag_ids=park,park,climbing&modes=car,bicycle"));
    expect(r.success && r.data.tag_ids).toEqual(["park", "climbing"]);
    expect(r.success && r.data.modes).toEqual(["car", "bicycle"]);
  });
});
