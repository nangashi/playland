import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemDetailResponse } from "../src/domain/api";
import { sha256Hex } from "../src/domain/image";
import { applyPhotos, photoListSchema, sourceKeyResolver, type PhotoManifestEntry } from "../src/ingest/photos";
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

async function entry(index: number, bytes: Uint8Array = PNG, overrides: Partial<PhotoManifestEntry> = {}): Promise<PhotoManifestEntry> {
  return {
    index,
    status: "ok",
    error: null,
    file: `${index}.png`,
    content_type: "image/png",
    byte_size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    candidate,
    ...overrides,
  };
}

beforeEach(async () => {
  await seed();
  await env.DB.prepare(
    `INSERT INTO source_entries (id, item_id, source_id, source_key, url, fetched_at, batch_id, created_at)
     VALUES ('se-1', 'it-woodshop-spot', 'official-site', 'woodshop', 'https://example.com/woodshop', 'x', 'b', 'x')`,
  ).run();
});

const run = (inputs: { entry: PhotoManifestEntry; bytes: Uint8Array | null }[], accept: number[]) =>
  applyPhotos(env.DB, env.MEDIA, inputs, new Set(accept), { resolveItem: sourceKeyResolver(env.DB) });

describe("写真の保存", () => {
  it("親が採用したものだけを、出典付きで保存し、カードに使う", async () => {
    const r = await run([{ entry: await entry(0), bytes: PNG }, { entry: await entry(1), bytes: null }], [0]);
    expect(r.map((o) => o.result)).toEqual(["saved", "skipped_not_accepted"]);
    const row = await env.DB.prepare("SELECT * FROM media WHERE item_id = 'it-woodshop-spot'").first<Record<string, unknown>>();
    expect(row).toMatchObject({
      kind: "venue",
      source_url: "https://example.com/woodshop",
      credit: "サンプル木工房 公式サイト",
      reviewed_by: "parent",
      content_type: "image/png",
      status: "active",
    });
    expect(String(row?.license_note)).toMatch(/家族内の私的な利用.*https:\/\/example\.com\/img\/workshop\.jpg/);
    const detail: ItemDetailResponse = await (await get("/api/items/it-woodshop-spot")).json();
    expect(detail.cover).toEqual({ id: r[0]!.media_id, kind: "venue" });
    expect((await get(`/media/${r[0]!.media_id}`)).status).toBe(200);
  });

  it("写っているものの説明を保存し、詳細に返す", async () => {
    await run([{ entry: await entry(0), bytes: PNG }], [0]);
    const detail: ItemDetailResponse = await (await get("/api/items/it-woodshop-spot")).json();
    expect(detail.media[0]).toMatchObject({ caption: "作業台のある工房", credit: "サンプル木工房 公式サイト" });
  });

  it("保存済みの写真に説明がなければ補い、親が入れた説明は変えない", async () => {
    const noCaption = { ...(await entry(0)), candidate: { ...candidate, caption: null } };
    const [saved] = await run([{ entry: noCaption, bytes: PNG }], [0]);
    await run([{ entry: await entry(0), bytes: PNG }], [0]);
    const filled = await env.DB.prepare("SELECT caption FROM media WHERE id = ?").bind(saved!.media_id).first();
    expect(filled).toEqual({ caption: "作業台のある工房" });
    await env.DB.prepare("UPDATE media SET caption = '親の説明' WHERE id = ?").bind(saved!.media_id).run();
    await run([{ entry: await entry(0), bytes: PNG }], [0]);
    const kept = await env.DB.prepare("SELECT caption FROM media WHERE id = ?").bind(saved!.media_id).first();
    expect(kept).toEqual({ caption: "親の説明" });
  });

  it("同じ画像の再実行では重複して保存しない", async () => {
    await run([{ entry: await entry(0), bytes: PNG }], [0]);
    const again = await run([{ entry: await entry(0), bytes: PNG }], [0]);
    expect(again[0]?.result).toBe("skipped_duplicate");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("取得後に内容が変わったもの・画像でないもの・未登録の候補は保存しない", async () => {
    const changed = await run([{ entry: await entry(0, PNG, { sha256: "0".repeat(64) }), bytes: PNG }], [0]);
    expect(changed[0]?.result).toBe("error");
    const text = new TextEncoder().encode("<svg/>");
    const notImage = await run([{ entry: await entry(0, text), bytes: text }], [0]);
    expect(notImage[0]?.result).toBe("error");
    const unknownItem = await run(
      [{ entry: { ...(await entry(0)), candidate: { ...candidate, item: { source_id: "official-site", source_key: "nope" } } }, bytes: PNG }],
      [0],
    );
    expect(unknownItem[0]?.result).toBe("error");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("写真リストの形式を検証する（出典・種類は必須）", () => {
    const ok = { schema_version: 1, batch_id: "p1", photos: [candidate] };
    expect(photoListSchema.safeParse(ok).success).toBe(true);
    expect(photoListSchema.safeParse({ ...ok, photos: [{ ...candidate, credit: "" }] }).success).toBe(false);
    expect(photoListSchema.safeParse({ ...ok, photos: [{ ...candidate, image_url: "javascript:x" }] }).success).toBe(false);
  });
});
