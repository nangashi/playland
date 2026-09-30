import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminInboxResponse, ItemDetailResponse } from "../src/domain/api";
import { itemResolver, stagePhotos } from "../src/ingest/photos";
import { get, parentLogin, seed, sendJson } from "./helpers";

// 1x1 の PNG と、中身の違う 2 枚目
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const PNG2 = Uint8Array.from([...PNG, 0]);

/** it-draft（下書き）と it-park-spot（公開中）に採用待ちの写真を 2 枚ずつ置く */
async function stage(itemId: string): Promise<string[]> {
  const candidate = {
    item: { item_id: itemId },
    image_url: "https://example.com/a.png",
    page_url: "https://example.com/",
    kind: "venue" as const,
    credit: "公式サイト",
    caption: null,
  };
  const outcomes = await stagePhotos(
    env.DB,
    env.MEDIA,
    [PNG, PNG2].map((bytes, index) => ({ index, candidate, bytes })),
    { resolveItem: itemResolver(env.DB) },
  );
  return outcomes.map((o) => o.media_id!);
}

async function inbox(headers: Record<string, string>): Promise<AdminInboxResponse> {
  const res = await get("/api/admin/inbox", { headers });
  expect(res.status).toBe(200);
  return res.json();
}

const decide = (id: string, body: unknown, headers: Record<string, string>) =>
  sendJson("POST", `/api/admin/inbox/${id}`, body, headers);

beforeEach(async () => {
  await seed();
  await env.DB.prepare(
    `INSERT INTO source_entries (id, item_id, source_id, source_key, url, fetched_at, evidence, needs_review, suggested_tags, batch_id, created_at)
     VALUES ('se-1', 'it-draft', 'official-site', 'draft', 'https://example.com/', 'x',
             '[{"field":"item.price","text":"大人500円","source_url":"https://example.com/"}]', '["休館日を確認"]', '["恐竜"]', 'b1', 'x')`,
  ).run();
});

describe("承認待ち", () => {
  it("親セッションなしでは見られない・判断できない", async () => {
    expect((await get("/api/admin/inbox")).status).toBe(401);
    expect((await decide("it-draft", { version: 1, decision: "publish" }, {})).status).toBe(401);
    const [mediaId] = await stage("it-draft");
    expect((await get(`/api/admin/media/${mediaId}/file`)).status).toBe(401);
  });

  it("下書きと、採用待ちの写真がある候補を、根拠・要確認と一緒に返す", async () => {
    await stage("it-park-spot");
    const headers = await parentLogin();
    const { entries } = await inbox(headers);
    expect(entries.map((e) => e.item.id).sort()).toEqual(["it-draft", "it-park-spot"]);
    const draft = entries.find((e) => e.item.id === "it-draft")!;
    expect(draft.sources[0]).toMatchObject({
      evidence: [{ field: "item.price", text: "大人500円" }],
      needs_review: ["休館日を確認"],
      suggested_tags: ["恐竜"],
    });
    const park = entries.find((e) => e.item.id === "it-park-spot")!;
    expect(park.media.map((m) => m.status)).toEqual(["pending", "pending"]);
  });

  it("採用待ちの写真は親の画面でだけ見られる", async () => {
    const [mediaId] = await stage("it-park-spot");
    const headers = await parentLogin();
    expect((await get(`/media/${mediaId}`)).status).toBe(404);
    const res = await get(`/api/admin/media/${mediaId}/file`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    // 通常の表示切り替えでは採用待ちを表示にできない
    await sendJson("PATCH", `/api/admin/media/${mediaId}`, { status: "active" }, headers);
    const row = await env.DB.prepare("SELECT status FROM media WHERE id = ?").bind(mediaId).first();
    expect(row).toEqual({ status: "pending" });
  });

  it("公開すると一覧に出て、選んだ写真だけを表示し、選ばなかった写真は消す", async () => {
    const [keep, drop] = await stage("it-draft");
    const headers = await parentLogin();
    const res = await decide("it-draft", { version: 1, decision: "publish", accept_media_ids: [keep] }, headers);
    expect(res.status).toBe(200);

    const detail: ItemDetailResponse = await (await get("/api/items/it-draft")).json();
    expect(detail.cover).toEqual({ id: keep, kind: "venue" });
    expect(detail.media.map((m) => m.id)).toEqual([keep]);
    const row = await env.DB.prepare("SELECT status, reviewed_by, reviewed_at FROM media WHERE id = ?").bind(keep).first();
    expect(row).toMatchObject({ status: "active" });
    expect(row?.reviewed_at).not.toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media WHERE id = ?").bind(drop).first()).toBeNull();
    expect(await env.MEDIA.get(`media/${drop}`)).toBeNull();
    expect((await inbox(headers)).entries).toEqual([]);
  });

  it("見送ると非表示になり、採用待ちの写真はすべて消す", async () => {
    const ids = await stage("it-draft");
    const headers = await parentLogin();
    const res = await decide("it-draft", { version: 1, decision: "reject", accept_media_ids: ids }, headers);
    expect(res.status).toBe(200);
    const item = await env.DB.prepare("SELECT publish_status FROM items WHERE id = 'it-draft'").first();
    expect(item).toEqual({ publish_status: "hidden" });
    expect((await get("/api/items/it-draft")).status).toBe(404);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE item_id = 'it-draft'").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("公開中の候補は写真だけを確定できる（公開状態は変えない）", async () => {
    const [keep] = await stage("it-park-spot");
    const headers = await parentLogin();
    expect((await decide("it-park-spot", { version: 1, decision: "publish" }, headers)).status).toBe(409);
    const res = await decide("it-park-spot", { version: 1, decision: "photos", accept_media_ids: [keep] }, headers);
    expect(res.status).toBe(200);
    const detail: ItemDetailResponse = await (await get("/api/items/it-park-spot")).json();
    expect(detail.media.map((m) => m.id)).toEqual([keep]);
  });

  it("他の端末で先に変わっていたら、何も変えずに 409", async () => {
    const [keep] = await stage("it-draft");
    const headers = await parentLogin();
    const res = await decide("it-draft", { version: 99, decision: "publish", accept_media_ids: [keep] }, headers);
    expect(res.status).toBe(409);
    const item = await env.DB.prepare("SELECT publish_status FROM items WHERE id = 'it-draft'").first();
    expect(item).toEqual({ publish_status: "draft" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE item_id = 'it-draft' AND status = 'pending'").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it("他の候補の写真を採用できない", async () => {
    const [other] = await stage("it-park-spot");
    const headers = await parentLogin();
    await decide("it-draft", { version: 1, decision: "publish", accept_media_ids: [other] }, headers);
    const row = await env.DB.prepare("SELECT status FROM media WHERE id = ?").bind(other).first();
    expect(row).toEqual({ status: "pending" });
  });
});
