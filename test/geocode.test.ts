import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addressForQuery, geocodePlaces, normalizeAddress, pickCandidate, type Geocoder } from "../src/ingest/geocode";
import { parentLogin, seed, sendJson } from "./helpers";

describe("住所の正規化と照合", () => {
  it("複数の住所・括弧・建物名・複数の丁目を検索用に整える", () => {
    expect(addressForQuery("小金井市桜町三丁目、関野町一・二丁目")).toBe("小金井市桜町三丁目");
    expect(addressForQuery("東京都立川市緑町3173（管理センター）")).toBe("東京都立川市緑町3173");
    expect(addressForQuery("東京都新宿区四谷4-20 四谷ひろば内")).toBe("東京都新宿区四谷4-20");
    expect(addressForQuery("練馬区光が丘二・四丁目、旭町二丁目")).toBe("練馬区光が丘二丁目");
  });

  it("漢数字の丁目・番地をそろえ、都道府県を除く", () => {
    expect(normalizeAddress("東京都西東京市芝久保町五丁目１０")).toBe("西東京市芝久保町5-10");
    expect(normalizeAddress("西東京市芝久保町5-10-64")).toBe("西東京市芝久保町5-10-64");
    expect(normalizeAddress("小金井市桜町三丁目")).toBe("小金井市桜町3");
  });

  it("問い合わせの先頭と一致する結果だけを採用する", () => {
    const c = (title: string) => ({ title, latitude: 35, longitude: 139 });
    expect(pickCandidate("西東京市芝久保町5-10-64", [c("東京都西東京市芝久保町五丁目１０")])?.title).toBe(
      "東京都西東京市芝久保町五丁目１０",
    );
    // 市区町村だけの一致・別の町・数字の途中で切れる一致は採用しない
    expect(pickCandidate("西東京市芝久保町5-10-64", [c("東京都西東京市")])).toBeNull();
    expect(pickCandidate("西東京市芝久保町5-10-64", [c("東京都西東京市緑町三丁目")])).toBeNull();
    expect(pickCandidate("西東京市芝久保町50-1", [c("東京都西東京市芝久保町五丁目")])).toBeNull();
  });
});

describe("geocodePlaces", () => {
  beforeEach(async () => {
    await seed();
    const now = "2026-09-30T00:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO places (id, name, address_text, created_at, updated_at) VALUES ('pl-geo', '住所だけの場所', '西東京市芝久保町5-10-64', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO places (id, name, address_text, created_at, updated_at) VALUES ('pl-miss', '見つからない場所', '架空市どこか町1-1', ?, ?)`,
      ).bind(now, now),
    ]);
  });

  const fake: Geocoder = async (q) =>
    q.startsWith("西東京市芝久保町") ? [{ title: "東京都西東京市芝久保町五丁目１０", latitude: 35.72, longitude: 139.53 }] : [];

  it("確認だけなら書き込まない", async () => {
    const r = await geocodePlaces(env.DB, fake, { apply: false });
    expect(r.find((o) => o.place_id === "pl-geo")).toMatchObject({ status: "found", applied: false });
    const row = await env.DB.prepare("SELECT latitude FROM places WHERE id = 'pl-geo'").first();
    expect(row).toEqual({ latitude: null });
  });

  it("おおよその位置として出どころ付きで保存し、見つからないものは空のまま", async () => {
    const r = await geocodePlaces(env.DB, fake, { apply: true });
    expect(r.find((o) => o.place_id === "pl-miss")?.status).toBe("not_found");
    const row = await env.DB.prepare(
      "SELECT latitude, longitude, position_accuracy, position_source, position_note, version FROM places WHERE id = 'pl-geo'",
    ).first();
    expect(row).toMatchObject({
      latitude: 35.72,
      longitude: 139.53,
      position_accuracy: "approximate",
      position_source: "geocoder",
      version: 2,
    });
    expect((row as { position_note: string }).position_note).toMatch(/国土地理院/);
    const miss = await env.DB.prepare("SELECT latitude FROM places WHERE id = 'pl-miss'").first();
    expect(miss).toEqual({ latitude: null });
    // 再実行しても対象にならない
    expect((await geocodePlaces(env.DB, fake, { apply: true })).map((o) => o.place_id)).not.toContain("pl-geo");
  });

  it("座標がある場所・親が指定（消去）した場所は対象にしない", async () => {
    const headers = await parentLogin();
    const res = await sendJson("PATCH", "/api/admin/places/pl-geo", { version: 1, latitude: null, longitude: null }, headers);
    expect(res.status).toBe(200);
    const r = await geocodePlaces(env.DB, fake, { apply: true });
    expect(r.map((o) => o.place_id)).not.toContain("pl-geo");
    expect(r.map((o) => o.place_id)).not.toContain("pl-sample-science");
  });

  it("検索サービスの失敗は失敗として返し、ほかの場所は続ける", async () => {
    const flaky: Geocoder = async (q) => {
      if (q.startsWith("架空市")) throw new Error("timeout");
      return fake(q);
    };
    const r = await geocodePlaces(env.DB, flaky, { apply: true });
    expect(r.find((o) => o.place_id === "pl-miss")).toMatchObject({ status: "error", error: "timeout" });
    expect(r.find((o) => o.place_id === "pl-geo")?.applied).toBe(true);
  });
});
