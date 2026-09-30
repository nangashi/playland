import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemDetailResponse } from "../src/domain/api";
import { itemResolver, photoListSchema, stagePhotos, type PhotoCandidate } from "../src/ingest/photos";
import { get, seed } from "./helpers";

// 1x1 の PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const candidate = {
  item: { source_id: "official-site", source_key: "woodshop" },
  image_url: "https://example.com/img/workshop.jpg",
  page_url: "https://example.com/woodshop",
  kind: "venue" as const,
  credit: "サンプル木工房 公式サイト",
  caption: "作業台のある工房",
};

beforeEach(async () => {
  await seed();
  await env.DB.prepare(
    `INSERT INTO source_entries (id, item_id, source_id, source_key, url, fetched_at, batch_id, created_at)
     VALUES ('se-1', 'it-woodshop-spot', 'official-site', 'woodshop', 'https://example.com/woodshop', 'x', 'b', 'x')`,
  ).run();
});

const run = (inputs: { candidate?: PhotoCandidate; bytes: Uint8Array | null }[]) =>
  stagePhotos(
    env.DB,
    env.MEDIA,
    inputs.map((x, index) => ({ index, candidate: x.candidate ?? candidate, bytes: x.bytes })),
    { resolveItem: itemResolver(env.DB) },
  );

describe("写真の保存（採用待ち）", () => {
  it("出典付きで採用待ちとして保存し、家族の画面には出さない", async () => {
    const r = await run([{ bytes: PNG }, { bytes: null }]);
    expect(r.map((o) => o.result)).toEqual(["staged", "error"]);
    const row = await env.DB.prepare("SELECT * FROM media WHERE item_id = 'it-woodshop-spot'").first<Record<string, unknown>>();
    expect(row).toMatchObject({
      kind: "venue",
      source_url: "https://example.com/woodshop",
      credit: "サンプル木工房 公式サイト",
      caption: "作業台のある工房",
      reviewed_by: null,
      content_type: "image/png",
      status: "pending",
    });
    expect(String(row?.license_note)).toMatch(/家族内の私的な利用.*https:\/\/example\.com\/img\/workshop\.jpg/);
    const detail: ItemDetailResponse = await (await get("/api/items/it-woodshop-spot")).json();
    expect(detail.media).toEqual([]);
    expect(detail.cover).toBeNull();
    expect((await get(`/media/${r[0]!.media_id}`)).status).toBe(404);
  });

  it("保存済みの写真に説明がなければ補い、親が入れた説明は変えない", async () => {
    const [saved] = await run([{ candidate: { ...candidate, caption: null }, bytes: PNG }]);
    await run([{ bytes: PNG }]);
    const filled = await env.DB.prepare("SELECT caption FROM media WHERE id = ?").bind(saved!.media_id).first();
    expect(filled).toEqual({ caption: "作業台のある工房" });
    await env.DB.prepare("UPDATE media SET caption = '親の説明' WHERE id = ?").bind(saved!.media_id).run();
    await run([{ bytes: PNG }]);
    const kept = await env.DB.prepare("SELECT caption FROM media WHERE id = ?").bind(saved!.media_id).first();
    expect(kept).toEqual({ caption: "親の説明" });
  });

  it("同じ画像の再実行では重複して保存しない", async () => {
    await run([{ bytes: PNG }]);
    const again = await run([{ bytes: PNG }]);
    expect(again[0]?.result).toBe("skipped_duplicate");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("画像でないもの・未登録の候補は保存しない", async () => {
    const notImage = await run([{ bytes: new TextEncoder().encode("<svg/>") }]);
    expect(notImage[0]?.result).toBe("error");
    const unknownItem = await run([{ candidate: { ...candidate, item: { source_id: "official-site", source_key: "nope" } }, bytes: PNG }]);
    expect(unknownItem[0]?.result).toBe("error");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("出典キーのない候補（管理画面で追加したもの）は item_id で指定できる", async () => {
    const byId = (itemId: string) => ({ ...candidate, item: { item_id: itemId } });
    const r = await run([{ candidate: byId("it-farm-spot"), bytes: PNG }]);
    expect(r[0]?.result).toBe("staged");
    const row = await env.DB.prepare("SELECT item_id FROM media WHERE id = ?").bind(r[0]!.media_id).first();
    expect(row).toEqual({ item_id: "it-farm-spot" });
    const missing = await run([{ candidate: byId("it-nope"), bytes: PNG }]);
    expect(missing[0]).toMatchObject({ result: "error", reason: "対応する候補が登録されていません" });
  });

  it("写真リストの形式を検証する（出典・種類は必須）", () => {
    const ok = { schema_version: 1, batch_id: "p1", photos: [candidate] };
    expect(photoListSchema.safeParse(ok).success).toBe(true);
    expect(photoListSchema.safeParse({ ...ok, photos: [{ ...candidate, credit: "" }] }).success).toBe(false);
    expect(photoListSchema.safeParse({ ...ok, photos: [{ ...candidate, image_url: "javascript:x" }] }).success).toBe(false);
    expect(photoListSchema.safeParse({ ...ok, photos: [{ ...candidate, item: { item_id: "it-farm-spot" } }] }).success).toBe(true);
    // 出典キーと item_id を混ぜた指定は受け付けない
    const mixed = { item_id: "it-farm-spot", source_id: "official-site", source_key: "woodshop" };
    expect(photoListSchema.safeParse({ ...ok, photos: [{ ...candidate, item: mixed }] }).success).toBe(false);
  });
});
