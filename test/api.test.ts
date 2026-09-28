import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemDetailResponse, ItemListResponse, ProfileListResponse } from "../src/domain/api";
import { get, seed, send } from "./helpers";

beforeEach(seed);

async function list(query = ""): Promise<ItemListResponse> {
  const res = await get(`/api/items${query}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/items", () => {
  it("公開中の候補を返し、下書き・非表示は含めない", async () => {
    const body = await list();
    const ids = body.items.map((i) => i.id);
    expect(body.total).toBe(7);
    expect(ids).not.toContain("it-draft");
    expect(ids).not.toContain("it-hidden");
  });

  it("写真・座標・会場がなくても一覧に載る（A11）", async () => {
    const body = await list();
    const wood = body.items.find((i) => i.id === "it-wood-event");
    expect(wood).toMatchObject({ place: null, child_description: null, rain_policy: "unknown" });
    const gym = body.items.find((i) => i.id === "it-gym-spot");
    expect(gym?.place?.name).toBe("サンプルクライミングジム");
  });

  it("不明な雨天対応を ok などに変換しない", async () => {
    const body = await list();
    expect(body.items.find((i) => i.id === "it-gym-spot")?.rain_policy).toBe("unknown");
  });

  it("同じ API で保存済みに絞れる（A03）", async () => {
    const mine = await list("?favorites=mine&profile_id=pr-sora");
    expect(mine.items.map((i) => i.id)).toEqual(["it-science-slime"]);
    const family = await list("?favorites=family");
    expect(family.items.map((i) => i.id).sort()).toEqual(["it-park-spot", "it-science-slime"]);
  });

  it("不正な条件は 400", async () => {
    expect((await get("/api/items?favorites=mine")).status).toBe(400);
  });

  it("家族のデータを共有キャッシュに載せない", async () => {
    const res = await get("/api/items");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("GET /api/items/:id", () => {
  it("会場と保存状態を含む詳細を返す", async () => {
    const res = await get("/api/items/it-science-slime");
    const body: ItemDetailResponse = await res.json();
    expect(body.place).toMatchObject({ id: "pl-sample-science", position_accuracy: "exact" });
    expect(body.saved_by_profile_ids).toEqual(["pr-sora"]);
  });

  it("下書きや存在しない候補は 404", async () => {
    expect((await get("/api/items/it-draft")).status).toBe(404);
    expect((await get("/api/items/nope")).status).toBe(404);
  });
});

describe("GET /api/profiles", () => {
  it("有効なプロフィールを並び順で返す", async () => {
    const body: ProfileListResponse = await (await get("/api/profiles")).json();
    expect(body.profiles.map((p) => p.id)).toEqual(["pr-sora", "pr-umi", "pr-parent"]);
  });
});

describe("お気に入り", () => {
  const path = "/api/profiles/pr-umi/favorites/it-gym-spot";

  it("PUT を繰り返しても 1 件だけ（冪等）", async () => {
    expect((await send("PUT", path)).status).toBe(204);
    expect((await send("PUT", path)).status).toBe(204);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM favorites WHERE profile_id = 'pr-umi' AND item_id = 'it-gym-spot'",
    ).all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it("保存したものは D1 から別のリクエストで参照できる（A02）", async () => {
    await send("PUT", path);
    const mine = await list("?favorites=mine&profile_id=pr-umi");
    expect(mine.items.map((i) => i.id).sort()).toEqual(["it-gym-spot", "it-park-spot"]);
  });

  it("DELETE は存在しなくても成功", async () => {
    expect((await send("DELETE", path)).status).toBe(204);
    await send("PUT", path);
    expect((await send("DELETE", path)).status).toBe(204);
    const mine = await list("?favorites=mine&profile_id=pr-umi");
    expect(mine.items.map((i) => i.id)).toEqual(["it-park-spot"]);
  });

  it("存在しないプロフィール・非公開の候補には保存できない", async () => {
    expect((await send("PUT", "/api/profiles/pr-nobody/favorites/it-gym-spot")).status).toBe(404);
    expect((await send("PUT", "/api/profiles/pr-umi/favorites/it-draft")).status).toBe(404);
  });

  it("別オリジンや Origin なしの書き込みは拒否（CSRF）", async () => {
    expect((await send("PUT", path, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await send("PUT", path, {})).status).toBe(403);
  });

  it("候補の内容を変えても、お気に入りは参照なので同じ候補として表示される", async () => {
    await env.DB.prepare("UPDATE items SET title = '新しい名前' WHERE id = 'it-science-slime'").run();
    const mine = await list("?favorites=mine&profile_id=pr-sora");
    expect(mine.items[0]).toMatchObject({ id: "it-science-slime", title: "新しい名前" });
  });
});
