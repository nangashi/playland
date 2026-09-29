import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemListResponse, MapItemsResponse } from "../src/domain/api";
import { buildVenueGroups, clusterScreenPoints } from "../src/domain/map";
import { makeItem } from "./factories";
import { get, parentLogin, seed, sendJson } from "./helpers";

const place = (id: string, lat: number | null, lng: number | null) => ({
  id,
  name: id,
  latitude: lat,
  longitude: lng,
  position_accuracy: lat === null ? ("unknown" as const) : ("exact" as const),
});

describe("buildVenueGroups", () => {
  const places = new Map([
    ["pa", place("pa", 35, 139)],
    ["pb", place("pb", 35.1, 139.1)],
    ["no-coords", place("no-coords", null, null)],
  ]);
  const entries = [
    { item: makeItem("b1", { place_id: "pb" }) },
    { item: makeItem("a1", { place_id: "pa" }) },
    { item: makeItem("a2", { kind: "event", place_id: "pa" }) },
    { item: makeItem("x", { place_id: "no-coords" }) },
    { item: makeItem("y", { kind: "event", place_id: null }) },
  ];

  it("同じ会場の候補を 1 つにまとめ、検索の並び順を保つ", () => {
    const r = buildVenueGroups(entries, places);
    expect(r.venues.map((v) => [v.place.id, v.entries.map((e) => e.item.id)])).toEqual([
      ["pb", ["b1"]],
      ["pa", ["a1", "a2"]],
    ]);
  });

  it("座標なし・会場不明は除外せず件数で返す（A11・A13）", () => {
    expect(buildVenueGroups(entries, places).unpositioned).toBe(2);
  });

  it("上限を超えた会場数を明示する", () => {
    const r = buildVenueGroups(entries, places, 1);
    expect(r.venues).toHaveLength(1);
    expect(r.omitted_venues).toBe(1);
  });
});

describe("clusterScreenPoints", () => {
  it("近い点だけをまとめる", () => {
    const r = clusterScreenPoints(
      [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 10, y: 10 },
        { id: "c", x: 200, y: 0 },
      ],
      40,
    );
    expect(r.map((c) => c.ids)).toEqual([["a", "b"], ["c"]]);
  });
});

describe("GET /api/map-items", () => {
  beforeEach(seed);

  async function map(query = ""): Promise<MapItemsResponse> {
    const res = await get(`/api/map-items${query}`);
    expect(res.status).toBe(200);
    return res.json();
  }

  async function listIds(query = ""): Promise<string[]> {
    const body: ItemListResponse = await (await get(`/api/items?limit=100${query ? `&${query.slice(1)}` : ""}`)).json();
    return body.items.map((i) => i.id).sort();
  }

  it("一覧と同じ条件・同じ候補集合を使う（A13）", async () => {
    for (const q of ["", "?rain=ok", "?purpose=today", "?favorites=family", "?tag_ids=park,science_museum"]) {
      const body = await map(q);
      const ids = body.venues.flatMap((v) => v.items.map((i) => i.id));
      const list = await listIds(q);
      expect(body.total, q).toBe(list.length);
      expect(ids.length + body.unpositioned, q).toBe(list.length);
      expect(ids.every((id) => list.includes(id)), q).toBe(true);
    }
  });

  it("同じ会場の常設スポットとイベントを 1 つのマーカーから選べる", async () => {
    const body = await map();
    const science = body.venues.find((v) => v.place.id === "pl-sample-science");
    expect(science?.items.map((i) => i.id).sort()).toEqual(["it-science-slime", "it-science-spot"]);
    expect(body.venues.find((v) => v.place.id === "pl-sample-park")?.place.position_accuracy).toBe("approximate");
  });

  it("位置不明の候補は件数で分かる（会場の座標なし・会場不明）", async () => {
    const body = await map();
    // it-gym-spot（座標なし）と it-wood-event（会場不明）
    expect(body.unpositioned).toBe(2);
  });

  it("一覧の 1 ページ目だけに限らない", async () => {
    const now = "2026-09-20T00:00:00.000Z";
    const stmts = Array.from({ length: 40 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO items (id, kind, place_id, title, publish_status, created_at, updated_at)
         VALUES (?, 'event', 'pl-sample-park', ?, 'published', ?, ?)`,
      ).bind(`it-bulk-${i}`, `まとめて ${i}`, now, now),
    );
    await env.DB.batch(stmts);
    const list: ItemListResponse = await (await get("/api/items")).json();
    expect(list.items.length).toBe(30);
    const body = await map();
    const park = body.venues.find((v) => v.place.id === "pl-sample-park");
    expect(park?.items.length).toBe(42);
  });

  it("不正な条件は 400", async () => {
    expect((await get("/api/map-items?rain=maybe")).status).toBe(400);
  });

  it("自宅の座標は地図 API に含めない（A21）", async () => {
    const headers = await parentLogin();
    await sendJson("PATCH", "/api/admin/settings", { version: 1, origin_latitude: 35.4321, origin_longitude: 139.8765 }, headers);
    const text = await (await get("/api/map-items")).text();
    expect(text).not.toMatch(/35\.4321|139\.8765/);
  });
});
