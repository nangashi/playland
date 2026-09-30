import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { assertEmpty, copyMediaObjects, countRows, dumpDatabase, loadDatabase, mediaKeys, DATA_TABLES } from "../src/ops/transfer";
import { seed } from "./helpers";

async function clearData() {
  for (const t of [...DATA_TABLES].reverse()) await env.DB.prepare(`DELETE FROM ${t}`).run();
}

beforeEach(async () => {
  await seed();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO media (id, r2_key, item_id, kind, content_type, byte_size, sha256, created_at)
       VALUES ('m1', 'media/m1', 'it-park-spot', 'venue', 'image/png', 3, 'x', 'x')`,
    ),
    env.DB.prepare(`INSERT INTO hidden_items (item_id, created_at) VALUES ('it-gym-spot', 'x')`),
    env.DB.prepare(`UPDATE family_settings SET origin_label = '家', bicycle_max_minutes = 25`),
  ]);
});

describe("データの書き出し・書き込み", () => {
  it("書き出したものを空の DB に書き込むと、同じ内容になる", async () => {
    const snapshot = await dumpDatabase(env.DB);
    const before = await countRows(env.DB);
    await clearData();
    await env.DB.prepare(`UPDATE family_settings SET origin_label = '自宅', bicycle_max_minutes = 20`).run();
    await loadDatabase(env.DB, snapshot);
    expect(await countRows(env.DB)).toEqual(before);
    const again = await dumpDatabase(env.DB);
    expect(again.tables).toEqual(snapshot.tables);
    expect(again.family_settings).toMatchObject({ origin_label: "家", bicycle_max_minutes: 25 });
  });

  it("書き込み先にデータがあれば何も書かずに止める", async () => {
    const snapshot = await dumpDatabase(env.DB);
    await expect(assertEmpty(env.DB)).rejects.toThrow(/データがあります/);
    await expect(loadDatabase(env.DB, snapshot)).rejects.toThrow(/データがあります/);
  });

  it("写真ファイルを同じキーで複製し、既にあれば複製しない。元がなければ知らせる", async () => {
    const snapshot = await dumpDatabase(env.DB);
    const source = new Map([["media/m1", { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }]]);
    const get = async (k: string) => source.get(k) ?? null;
    const first = await copyMediaObjects(mediaKeys(snapshot), get, env.MEDIA);
    expect(first).toEqual({ copied: 1, exists: 0, missing: [] });
    expect(new Uint8Array(await (await env.MEDIA.get("media/m1"))!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const second = await copyMediaObjects(mediaKeys(snapshot), get, env.MEDIA);
    expect(second).toEqual({ copied: 0, exists: 1, missing: [] });
    const missing = await copyMediaObjects(["media/nope"], get, env.MEDIA);
    expect(missing.missing).toEqual(["media/nope"]);
  });
});
