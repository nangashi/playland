import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemDetailResponse, ItemListResponse } from "../src/domain/api";
import { app } from "../src/server/app";
import { get, ORIGIN, parentLogin, seed, sendJson } from "./helpers";

beforeEach(seed);

// 1x1 の PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function upload(
  headers: Record<string, string>,
  fields: Record<string, string>,
  bytes: Uint8Array = PNG,
  type = "image/png",
) {
  const form = new FormData();
  form.set("file", new File([bytes], "photo.png", { type }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return SELF.fetch(`${ORIGIN}/api/admin/media`, { method: "POST", headers: { Origin: ORIGIN, ...headers }, body: form });
}

describe("写真", () => {
  it("親が登録した写真を認証付きで返し、一覧のカードに使う", async () => {
    const headers = await parentLogin();
    const res = await upload(headers, { item_id: "it-gym-spot", kind: "venue", credit: "おうちのひと撮影" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const media = await get(`/media/${id}`);
    expect(media.status).toBe(200);
    expect(media.headers.get("Content-Type")).toBe("image/png");
    expect(media.headers.get("Cache-Control")).toMatch(/^private/);
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(PNG);

    const list: ItemListResponse = await (await get("/api/items")).json();
    expect(list.items.find((i) => i.id === "it-gym-spot")?.cover).toEqual({ id, kind: "venue" });
  });

  it("場所の写真は、候補自身の写真がなければカードに使う", async () => {
    const headers = await parentLogin();
    const res = await upload(headers, { place_id: "pl-sample-science", kind: "venue" });
    const { id } = (await res.json()) as { id: string };
    const detail: ItemDetailResponse = await (await get("/api/items/it-science-spot")).json();
    expect(detail.cover).toEqual({ id, kind: "venue" });
  });

  it("中身が画像でなければ、Content-Type を偽っても拒否", async () => {
    const headers = await parentLogin();
    const res = await upload(headers, { item_id: "it-gym-spot", kind: "venue" }, new TextEncoder().encode("<svg/>"), "image/png");
    expect(res.status).toBe(415);
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM media").all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it("親セッションなしでは登録できない", async () => {
    expect((await upload({}, { item_id: "it-gym-spot", kind: "venue" })).status).toBe(401);
  });

  it("非表示にした写真は返さず、カードは代替表示になる", async () => {
    const headers = await parentLogin();
    const { id } = (await (await upload(headers, { item_id: "it-gym-spot", kind: "image" })).json()) as { id: string };
    expect((await sendJson("PATCH", `/api/admin/media/${id}`, { status: "hidden" }, headers)).status).toBe(204);
    expect((await get(`/media/${id}`)).status).toBe(404);
    const detail: ItemDetailResponse = await (await get("/api/items/it-gym-spot")).json();
    expect(detail.cover).toBeNull();
  });

  it("写真も家族認証の内側（A17）", async () => {
    const headers = await parentLogin();
    const { id } = (await (await upload(headers, { item_id: "it-gym-spot", kind: "venue" })).json()) as { id: string };
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request(`https://playland.example/media/${id}`),
      { ...env, AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "family.cloudflareaccess.com", ACCESS_AUD: "aud" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("R2 の公開経路を設定していない", async () => {
    const raw = (await import("../wrangler.jsonc?raw")).default as string;
    const config = raw.replace(/^\s*\/\/.*$/gm, "");
    expect(config).not.toMatch(/r2\.dev|custom_domain|"public"/i);
  });
});
