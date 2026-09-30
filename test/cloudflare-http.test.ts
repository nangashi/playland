import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import sample from "../fixtures/ingest/sample-bundle.json";
import { applyBundle } from "../src/ingest/apply";
import { itemResolver, stagePhotos } from "../src/ingest/photos";
import { httpD1, httpR2, resolveAccountId, type Fetch } from "../scripts/lib/cloudflare-http";
import { seed } from "./helpers";

// 1x1 の PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const API = "https://api.cloudflare.com/client/v4/accounts/acc/";

/**
 * Cloudflare の HTTP API の代わり。D1 の query（単文・batch）と R2 のオブジェクトを、テスト用の D1・R2 で処理する。
 * batch は Workers の D1 と同じく 1 トランザクションで実行する（本番の HTTP API もそうであることは実環境で確認する）
 */
const requests: { method: string; url: string }[] = [];
const fakeFetch: Fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  requests.push({ method, url });
  expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  if (url === "https://api.cloudflare.com/client/v4/accounts") {
    return Response.json({ success: true, result: [{ id: "acc", name: "家族" }] });
  }
  if (url === `${API}d1/database/db1/query`) {
    const body = JSON.parse(String(init.body)) as { sql?: string; params?: unknown[]; batch?: { sql: string; params: unknown[] }[] };
    const stmts = (body.batch ?? [{ sql: body.sql!, params: body.params ?? [] }]).map((s) => env.DB.prepare(s.sql).bind(...s.params));
    try {
      const results = await env.DB.batch(stmts);
      return Response.json({ success: true, errors: [], result: results.map((r) => ({ results: r.results, success: true, meta: r.meta })) });
    } catch (err) {
      return Response.json({ success: false, errors: [{ code: 7500, message: String((err as Error).message) }], result: null }, { status: 400 });
    }
  }
  const prefix = `${API}r2/buckets/playland-media/objects/`;
  if (url.startsWith(prefix)) {
    const key = url.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    if (method === "PUT") {
      const type = new Headers(init.headers).get("Content-Type") ?? undefined;
      await env.MEDIA.put(key, init.body as Uint8Array, { httpMetadata: { contentType: type } });
      return Response.json({ success: true, result: {} });
    }
    if (method === "DELETE") {
      await env.MEDIA.delete(key);
      return Response.json({ success: true, result: {} });
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) return new Response("not found", { status: 404 });
    return new Response(await obj.arrayBuffer(), { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "" } });
  }
  return new Response("unexpected", { status: 500 });
};

const api = { token: "tok", accountId: "acc", fetch: fakeFetch };
const db = httpD1(api, "db1");
const bucket = httpR2(api, "playland-media");

beforeEach(async () => {
  requests.length = 0;
  await seed();
});

describe("Cloudflare HTTP API（本番への接続）", () => {
  it("トークンで見えるアカウントが 1 つなら、その ID を使う", async () => {
    expect(await resolveAccountId("tok", fakeFetch)).toBe("acc");
  });

  it("prepare・bind・first・all・run を HTTP で行う", async () => {
    expect(await db.prepare("SELECT title FROM items WHERE id = ?").bind("it-park-spot").first()).toEqual({ title: "サンプル森林公園" });
    expect(await db.prepare("SELECT title FROM items WHERE id = ?").bind("it-park-spot").first("title")).toBe("サンプル森林公園");
    expect(await db.prepare("SELECT id FROM items WHERE id = ?").bind("nope").first()).toBeNull();
    const all = await db.prepare("SELECT id FROM items WHERE publish_status = 'draft'").all<{ id: string }>();
    expect(all.results.map((r) => r.id)).toEqual(["it-draft"]);
    const run = await db.prepare("UPDATE items SET child_description = ? WHERE id = ?").bind("説明", "it-draft").run();
    expect(run.meta.changes).toBe(1);
  });

  it("batch は 1 回の要求で送り、失敗した文があれば全体を取り消す", async () => {
    const before = requests.length;
    await expect(
      db.batch([
        db.prepare("UPDATE items SET child_description = 'x' WHERE id = 'it-draft'"),
        db.prepare("INSERT INTO items (id, kind, title, created_at, updated_at) VALUES ('it-draft', 'spot', 'dup', 'x', 'x')"),
      ]),
    ).rejects.toThrow(/constraint/i);
    expect(requests.length - before).toBe(1);
    const row = await env.DB.prepare("SELECT child_description FROM items WHERE id = 'it-draft'").first();
    expect(row).toEqual({ child_description: null });
  });

  it("取り込み（下書きの登録・重複の判定）と写真の採用待ちでの保存が、HTTP 経由でもそのまま動く", async () => {
    const r = await applyBundle(db, sample, { target: "production", inputHash: "h", accept: "all" });
    expect(r.outcomes.map((o) => o.result)).toEqual(["inserted", "inserted", "inserted", "inserted"]);
    const again = await applyBundle(db, sample, { target: "production", inputHash: "h", accept: "all" });
    expect(again.outcomes.map((o) => o.result)).toEqual(["skipped_existing", "skipped_existing", "skipped_existing", "skipped_existing"]);

    const candidate = {
      item: { source_id: sample.candidates[0]!.source.source_id, source_key: sample.candidates[0]!.source.source_key },
      image_url: "https://example.com/a.png",
      page_url: "https://example.com/",
      kind: "venue" as const,
      credit: "公式サイト",
      caption: null,
    };
    const [staged] = await stagePhotos(db, bucket, [{ index: 0, candidate, bytes: PNG }], { resolveItem: itemResolver(db) });
    expect(staged).toMatchObject({ result: "staged" });
    const obj = await bucket.get(`media/${staged!.media_id}`);
    expect(obj?.httpMetadata?.contentType).toBe("image/png");
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(PNG);
    expect((await bucket.head(`media/${staged!.media_id}`))?.size).toBe(PNG.byteLength);
    await bucket.delete(`media/${staged!.media_id}`);
    expect(await bucket.get(`media/${staged!.media_id}`)).toBeNull();
  });
});
