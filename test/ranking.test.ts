import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { RankingResponse } from "../src/domain/api";
import { rankingEntries, reorderBookmarks } from "../src/domain/ranking";
import { data, makeItem } from "./factories";
import { get, seed, send, sendJson } from "./helpers";

const bm = (item_id: string, rank: number, created_at = "2026-09-10T00:00:00.000Z") => ({ item_id, created_at, rank });

describe("rankingEntries", () => {
  const d = data({
    items: [makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d"), makeItem("draft", { publish_status: "draft" })],
    bookmarks: [bm("a", 3), bm("b", 1), bm("c", 2), bm("draft", 0)],
    hidden: [{ item_id: "c", created_at: "2026-09-10T00:00:00.000Z" }],
  });

  it("保存したものを順位順に返し、非公開・興味なし・未保存は外す", () => {
    expect(rankingEntries(d).map((e) => e.item.id)).toEqual(["b", "a"]);
  });

  it("同じ順位は保存した順・ID 順", () => {
    const tie = data({
      items: [makeItem("a"), makeItem("b"), makeItem("c")],
      bookmarks: [bm("c", 0, "2026-09-01T00:00:00.000Z"), bm("b", 0, "2026-09-02T00:00:00.000Z"), bm("a", 0, "2026-09-02T00:00:00.000Z")],
    });
    expect(rankingEntries(tie).map((e) => e.item.id)).toEqual(["c", "a", "b"]);
  });
});

describe("reorderBookmarks", () => {
  const bookmarks = [bm("a", 1), bm("x", 2), bm("b", 3), bm("c", 4)];

  it("出ていない保存（x）の位置は変えずに、出ている候補を並べ替える", () => {
    expect(reorderBookmarks(bookmarks, ["a", "b", "c"], ["c", "a", "b"])).toEqual({ ok: true, order: ["c", "x", "a", "b"] });
  });

  it("組が一致しなければ反映しない", () => {
    expect(reorderBookmarks(bookmarks, ["a", "b", "c"], ["a", "b"]).ok).toBe(false);
    expect(reorderBookmarks(bookmarks, ["a", "b", "c"], ["a", "b", "x"]).ok).toBe(false);
    expect(reorderBookmarks(bookmarks, ["a", "b", "c"], ["a", "a", "b"]).ok).toBe(false);
  });
});

describe("/api/ranking", () => {
  beforeEach(seed);

  async function ranking(): Promise<string[]> {
    const res = await get("/api/ranking");
    expect(res.status).toBe(200);
    return ((await res.json()) as RankingResponse).items.map((i) => i.id);
  }

  it("保存したものを順位順に返し、新しく保存したものは最後に入る", async () => {
    expect(await ranking()).toEqual(["it-science-spot", "it-park-spot"]);
    await send("PUT", "/api/bookmarks/it-gym-spot");
    expect(await ranking()).toEqual(["it-science-spot", "it-park-spot", "it-gym-spot"]);
  });

  it("並べ替えを保存し、別のリクエストでも同じ順になる", async () => {
    const res = await sendJson("PUT", "/api/ranking", { item_ids: ["it-park-spot", "it-science-spot"] });
    expect(res.status).toBe(204);
    expect(await ranking()).toEqual(["it-park-spot", "it-science-spot"]);
  });

  it("興味なしにした候補は外し、戻すと元の位置に出る", async () => {
    await send("PUT", "/api/bookmarks/it-gym-spot");
    await send("PUT", "/api/hidden/it-science-spot");
    expect(await ranking()).toEqual(["it-park-spot", "it-gym-spot"]);
    expect((await sendJson("PUT", "/api/ranking", { item_ids: ["it-gym-spot", "it-park-spot"] })).status).toBe(204);
    await send("DELETE", "/api/hidden/it-science-spot");
    expect(await ranking()).toEqual(["it-science-spot", "it-gym-spot", "it-park-spot"]);
  });

  it("別の端末で保存が変わっていれば 409 で、何も書き換えない", async () => {
    await send("PUT", "/api/bookmarks/it-gym-spot");
    const res = await sendJson("PUT", "/api/ranking", { item_ids: ["it-park-spot", "it-science-spot"] });
    expect(res.status).toBe(409);
    expect(await ranking()).toEqual(["it-science-spot", "it-park-spot", "it-gym-spot"]);
  });

  it("不正な本文は 400、別オリジンは 403", async () => {
    expect((await sendJson("PUT", "/api/ranking", { item_ids: "x" })).status).toBe(400);
    expect((await sendJson("PUT", "/api/ranking", { item_ids: [] }, { Origin: "https://evil.example" })).status).toBe(403);
  });

  it("ランキングの順位も書き出しの対象（保存の行に含まれる）", async () => {
    const row = await env.DB.prepare("SELECT rank FROM bookmarks WHERE item_id = 'it-park-spot'").first<{ rank: number }>();
    expect(row?.rank).toBe(2);
  });
});
