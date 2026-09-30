import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AdminItemResponse,
  AdminPlaceResponse,
  AdminSettingsResponse,
  ItemDetailResponse,
  ItemListResponse,
} from "../src/domain/api";
import { app } from "../src/server/app";
import { get, ORIGIN, parentLogin, seed, sendJson } from "./helpers";

beforeEach(seed);

async function adminItem(id: string, headers: Record<string, string>): Promise<AdminItemResponse> {
  const res = await get(`/api/admin/items/${id}`, { headers });
  expect(res.status).toBe(200);
  return res.json();
}

describe("親の権限（A18）", () => {
  it("親セッションなしでは管理 API を使えない", async () => {
    expect((await get("/api/admin/items/it-gym-spot")).status).toBe(401);
    expect((await get("/api/admin/settings")).status).toBe(401);
    expect((await sendJson("PATCH", "/api/admin/items/it-gym-spot", { version: 1, rain_policy: "ok" })).status).toBe(401);
    expect((await sendJson("POST", "/api/admin/items", { title: "x", new_place_name: "y" })).status).toBe(401);
    const row = await env.DB.prepare("SELECT rain_policy FROM items WHERE id = 'it-gym-spot'").first();
    expect(row).toEqual({ rain_policy: "unknown" });
  });

  it("PIN が違えば拒否し、5 回失敗すると正しい PIN でも一時的に拒否", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await sendJson("POST", "/api/admin/session", { pin: "9999" })).status).toBe(401);
    }
    expect((await sendJson("POST", "/api/admin/session", { pin: "1234" })).status).toBe(429);
  });

  it("改ざんした Cookie は無効", async () => {
    const { Cookie } = await parentLogin();
    const tampered = Cookie!.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
    expect((await get("/api/admin/settings", { headers: { Cookie: tampered } })).status).toBe(401);
  });

  it("ログアウト後は使えない（Cookie を消す）", async () => {
    const headers = await parentLogin();
    const res = await sendJson("DELETE", "/api/admin/session", undefined, headers);
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
  });

  it("セッション Cookie は HttpOnly・Secure・SameSite=Strict", async () => {
    const res = await sendJson("POST", "/api/admin/session", { pin: "1234" });
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^__Host-pl_parent=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it("PIN・署名鍵が未設定なら拒否（fail closed）", async () => {
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request(`${ORIGIN}/api/admin/session`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      }),
      { ...env, PARENT_PIN: "" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
  });

  it("別オリジンからの管理操作は拒否", async () => {
    const headers = await parentLogin();
    const res = await sendJson("PATCH", "/api/admin/items/it-gym-spot", { version: 1, rain_policy: "ok" }, {
      ...headers,
      Origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("候補の編集", () => {
  it("指定した項目だけを変え、版を上げ、保存は変えない", async () => {
    const headers = await parentLogin();
    const before = await adminItem("it-woodshop-spot", headers);
    const res = await sendJson(
      "PATCH",
      "/api/admin/items/it-woodshop-spot",
      { version: before.item.version, rain_policy: "conditional", tag_ids: ["crafting"], experience_tags_status: "assessed" },
      headers,
    );
    expect(res.status).toBe(200);
    const after = await adminItem("it-woodshop-spot", headers);
    expect(after.item).toMatchObject({
      rain_policy: "conditional",
      version: before.item.version + 1,
      title: before.item.title,
      age_min: 6,
    });
    expect(after.item.parent_reviewed_at).not.toBeNull();
    expect(after.tag_ids).toEqual(["crafting"]);
    const { results } = await env.DB.prepare("SELECT item_id FROM bookmarks ORDER BY item_id").all();
    expect(results).toEqual([{ item_id: "it-park-spot" }, { item_id: "it-science-spot" }]);
  });

  it("古い版での編集は上書きせず 409。タグも変えない", async () => {
    const headers = await parentLogin();
    const before = await adminItem("it-science-spot", headers);
    await sendJson("PATCH", "/api/admin/items/it-science-spot", { version: before.item.version, title: "先の変更" }, headers);

    const res = await sendJson(
      "PATCH",
      "/api/admin/items/it-science-spot",
      { version: before.item.version, title: "後の変更", tag_ids: ["cooking"] },
      headers,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ current_version: before.item.version + 1 });
    const after = await adminItem("it-science-spot", headers);
    expect(after.item.title).toBe("先の変更");
    expect(after.tag_ids).toEqual(before.tag_ids);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target_id = 'it-science-spot'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("矛盾する入力は 400 で拒否し、何も変えない", async () => {
    const headers = await parentLogin();
    const { item } = await adminItem("it-woodshop-spot", headers);
    const bad = [
      { age_min_kind: "value", age_min: null },
      { age_min_kind: "value", age_min: 10, age_max_kind: "value", age_max: 5 },
      { tag_ids: ["not_a_tag"] },
      { publish_at: "now" },
      // 開催日は次のフェーズまで受け付けない
      { occurrences: [] },
      { official_url: "javascript:alert(1)" },
      { place_id: "pl-nowhere" },
    ];
    for (const patch of bad) {
      const res = await sendJson("PATCH", "/api/admin/items/it-woodshop-spot", { version: item.version, ...patch }, headers);
      expect(res.status, JSON.stringify(patch)).toBe(400);
    }
    expect((await adminItem("it-woodshop-spot", headers)).item.version).toBe(item.version);
  });

  it("URL・タイトル・場所だけで手動追加でき、分からない項目は不明のまま（A11）", async () => {
    const headers = await parentLogin();
    const res = await sendJson(
      "POST",
      "/api/admin/items",
      { title: "親が見つけた工房", official_url: "https://example.com/ws", new_place_name: "親が見つけた工房" },
      headers,
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const detail: ItemDetailResponse = await (await get(`/api/items/${id}`)).json();
    expect(detail).toMatchObject({
      rain_policy: "unknown",
      cover: null,
      eligibility: { guardian_rule: "unknown" },
      reservation_requirement: "unknown",
      price_status: "unknown",
    });
    expect((await sendJson("PUT", `/api/bookmarks/${id}`, undefined)).status).toBe(204);
  });

  it("場所なし・場所の二重指定の手動追加は拒否", async () => {
    const headers = await parentLogin();
    expect((await sendJson("POST", "/api/admin/items", { title: "x" }, headers)).status).toBe(400);
    expect(
      (await sendJson("POST", "/api/admin/items", { title: "x", place_id: "pl-sample-park", new_place_name: "y" }, headers)).status,
    ).toBe(400);
  });
});

describe("場所と移動の編集", () => {
  it("座標を消すと精度も不明に戻す。緯度だけの変更は拒否", async () => {
    const headers = await parentLogin();
    expect((await sendJson("PATCH", "/api/admin/places/pl-sample-park", { version: 1, latitude: 35 }, headers)).status).toBe(400);
    const res = await sendJson("PATCH", "/api/admin/places/pl-sample-park", { version: 1, latitude: null, longitude: null }, headers);
    expect(res.status).toBe(200);
    const body: AdminPlaceResponse = await (await get("/api/admin/places/pl-sample-park", { headers })).json();
    expect(body.place).toMatchObject({ latitude: null, position_accuracy: "unknown", version: 2 });
    // 親が消した座標は、住所検索で埋め直さない
    expect(body.place.position_source).toBe("parent");
  });

  it("手段の表示と親の目安を変更でき、一覧に反映される（A08・A09）", async () => {
    const headers = await parentLogin();
    const res = await sendJson(
      "PATCH",
      "/api/admin/places/pl-sample-park/transport",
      {
        version: 1,
        preferences: [{ mode: "car", visibility: "hide", note: "駐車場なし" }],
        estimates: [
          { mode: "bicycle", route_status: "estimated", minutes: 21, basis: "door_to_door" },
          { mode: "transit", route_status: "no_route" },
        ],
      },
      headers,
    );
    expect(res.status).toBe(200);
    const detail: ItemDetailResponse = await (await get("/api/items/it-park-spot")).json();
    const views = Object.fromEntries(detail.travel!.map((v) => [v.mode, v]));
    expect(views.car?.visible).toBe(false);
    expect(views.bicycle).toMatchObject({ visible: false, estimate: { minutes: 21 } });
    expect(views.transit).toMatchObject({ visible: true, estimate: { route_status: "no_route", minutes: null } });
  });

  it("出発地点を変えると古い所要時間を現行の値として使わない", async () => {
    const headers = await parentLogin();
    const settings: AdminSettingsResponse = await (await get("/api/admin/settings", { headers })).json();
    const res = await sendJson(
      "PATCH",
      "/api/admin/settings",
      { version: settings.version, origin_latitude: 35.1, origin_longitude: 139.1 },
      headers,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminSettingsResponse).origin_version).toBe(settings.origin_version + 1);

    const list: ItemListResponse = await (await get("/api/items?modes=bicycle&include_unknown=true")).json();
    expect(list.items.map((i) => i.id)).not.toContain("it-park-spot");
    const detail: ItemDetailResponse = await (await get("/api/items/it-park-spot")).json();
    expect(detail.travel?.find((v) => v.mode === "bicycle")).toMatchObject({ estimate: null, stale_only: true });
  });

  it("自宅を設定すると場所ごとの距離を保存し、日帰り・旅行で絞り込める。ピンを動かすと計算し直す", async () => {
    const headers = await parentLogin();
    const settings: AdminSettingsResponse = await (await get("/api/admin/settings", { headers })).json();
    await sendJson("PATCH", "/api/admin/settings", { version: settings.version, origin_latitude: 35.68, origin_longitude: 139.76 }, headers);
    const science: AdminPlaceResponse = await (await get("/api/admin/places/pl-sample-science", { headers })).json();
    expect(science.place).toMatchObject({ home_distance_km: 0, version: 1 });
    const gym: AdminPlaceResponse = await (await get("/api/admin/places/pl-sample-gym", { headers })).json();
    expect(gym.place.home_distance_km).toBeNull();

    const dayTrip: ItemListResponse = await (await get("/api/items?trip=day_trip")).json();
    expect(dayTrip.items.map((i) => i.id)).toContain("it-science-spot");
    expect(dayTrip.items.every((i) => i.trip === "day_trip")).toBe(true);

    // 北へ緯度 1 度（約 111km）動かすと旅行になる
    const res = await sendJson("PATCH", "/api/admin/places/pl-sample-science", { version: 1, latitude: 36.68, longitude: 139.76 }, headers);
    expect(res.status).toBe(200);
    const trip: ItemListResponse = await (await get("/api/items?trip=trip")).json();
    expect(trip.items.map((i) => i.id)).toEqual(["it-science-spot"]);
  });

  it("一般の設定 API と監査ログに自宅の座標を出さない（A21）", async () => {
    const headers = await parentLogin();
    await sendJson("PATCH", "/api/admin/settings", { version: 1, origin_latitude: 35.123, origin_longitude: 139.456 }, headers);
    const text = await (await get("/api/settings")).text();
    expect(text).not.toMatch(/35\.123|139\.456|latitude|longitude/);
    const { results } = await env.DB.prepare("SELECT * FROM audit_log WHERE target_type = 'settings'").all();
    expect(JSON.stringify(results)).not.toMatch(/35\.123|139\.456/);
  });
});
