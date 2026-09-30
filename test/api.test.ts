import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemDetailResponse, ItemListResponse } from "../src/domain/api";
import { get, seed, send } from "./helpers";

beforeEach(seed);

async function list(query = ""): Promise<ItemListResponse> {
  const res = await get(`/api/items${query}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/items", () => {
  it("公開中の常設スポットを返し、下書き・非表示・イベントは含めない", async () => {
    const now = "2026-09-20T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO items (id, kind, place_id, title, publish_status, created_at, updated_at)
       VALUES ('it-event', 'event', 'pl-sample-science', 'イベント', 'published', ?, ?)`,
    )
      .bind(now, now)
      .run();
    const body = await list();
    const ids = body.items.map((i) => i.id);
    expect(ids).not.toContain("it-draft");
    expect(ids).not.toContain("it-hidden");
    expect(ids).not.toContain("it-event");
    expect(body.total).toBe(7);
    expect((await get("/api/items/it-event")).status).toBe(404);
  });

  it("写真・座標・説明がなくても一覧に載る（A11）", async () => {
    const farm = (await list()).items.find((i) => i.id === "it-farm-spot");
    expect(farm).toMatchObject({ child_description: null, cover: null, place: { name: "サンプルふれあい牧場" } });
  });

  it("不明な雨天対応を ok などに変換しない", async () => {
    expect((await list()).items.find((i) => i.id === "it-gym-spot")?.rain_policy).toBe("unknown");
  });

  it("同じ API で保存済みに絞れる（A03）", async () => {
    const saved = await list("?saved=true");
    expect(saved.items.map((i) => i.id).sort()).toEqual(["it-park-spot", "it-science-spot"]);
    expect(saved.items.every((i) => i.saved)).toBe(true);
  });

  it("カテゴリと雨の日の条件で絞れる", async () => {
    const r = await list("?category=make&rain=ok");
    expect(r.items.map((i) => i.id).sort()).toEqual(["it-kids-spot", "it-woodshop-spot"]);
  });

  it("不正な条件は 400", async () => {
    expect((await get("/api/items?category=nope")).status).toBe(400);
  });

  it("家族のデータを共有キャッシュに載せない", async () => {
    expect((await get("/api/items")).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("GET /api/items/:id", () => {
  it("場所・参加条件・保存状態を含む詳細を返す", async () => {
    const body: ItemDetailResponse = await (await get("/api/items/it-woodshop-spot")).json();
    expect(body.place).toMatchObject({ id: "pl-sample-woodshop", position_accuracy: "exact" });
    expect(body.eligibility).toEqual({ guardian_rule: "required", sibling_rule: body.eligibility.sibling_rule });
    // 年齢の条件は画面に出さない
    expect(body).not.toHaveProperty("recommended_age_min");
    expect(body).toMatchObject({ reservation_requirement: "required", saved: false });
  });

  it("下書きや存在しない候補は 404", async () => {
    expect((await get("/api/items/it-draft")).status).toBe(404);
    expect((await get("/api/items/nope")).status).toBe(404);
  });
});

describe("家族の保存", () => {
  const path = "/api/bookmarks/it-gym-spot";

  it("PUT を繰り返しても 1 件だけ（冪等）", async () => {
    expect((await send("PUT", path)).status).toBe(204);
    expect((await send("PUT", path)).status).toBe(204);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM bookmarks WHERE item_id = 'it-gym-spot'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("保存したものは D1 から別のリクエストで参照できる（A02）", async () => {
    await send("PUT", path);
    const saved = await list("?saved=true");
    expect(saved.items.map((i) => i.id)).toContain("it-gym-spot");
  });

  it("DELETE は存在しなくても成功", async () => {
    expect((await send("DELETE", path)).status).toBe(204);
    await send("PUT", path);
    expect((await send("DELETE", path)).status).toBe(204);
    expect((await list("?saved=true")).items.map((i) => i.id)).not.toContain("it-gym-spot");
  });

  it("非公開の候補には保存できない", async () => {
    expect((await send("PUT", "/api/bookmarks/it-draft")).status).toBe(404);
  });

  it("別オリジンや Origin なしの書き込みは拒否（CSRF）", async () => {
    expect((await send("PUT", path, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await send("PUT", path, {})).status).toBe(403);
  });

  it("候補の内容を変えても、保存は参照なので同じ候補として表示される", async () => {
    await env.DB.prepare("UPDATE items SET title = '新しい名前' WHERE id = 'it-science-spot'").run();
    const saved = await list("?saved=true");
    expect(saved.items.find((i) => i.id === "it-science-spot")?.title).toBe("新しい名前");
  });
});

describe("家族の「興味なし」", () => {
  const path = "/api/hidden/it-gym-spot";

  it("興味なしにすると一覧・地図から消え、「興味なしも表示」で印付きで出る", async () => {
    expect((await send("PUT", path)).status).toBe(204);
    expect((await send("PUT", path)).status).toBe(204);
    expect((await list()).items.map((i) => i.id)).not.toContain("it-gym-spot");
    const withHidden = await list("?include_hidden=true");
    expect(withHidden.items.at(-1)).toMatchObject({ id: "it-gym-spot", hidden: true });
    const map = await (await get("/api/map-items")).json<{ total: number }>();
    expect(map.total).toBe(6);
    const detail: ItemDetailResponse = await (await get("/api/items/it-gym-spot")).json();
    expect(detail.hidden).toBe(true);
  });

  it("取り消せる。存在しなくても成功", async () => {
    await send("PUT", path);
    expect((await send("DELETE", path)).status).toBe(204);
    expect((await send("DELETE", path)).status).toBe(204);
    expect((await list()).items.map((i) => i.id)).toContain("it-gym-spot");
  });

  it("別オリジンからは変更できない（CSRF）", async () => {
    expect((await send("PUT", path, { Origin: "https://evil.example" })).status).toBe(403);
  });
});
