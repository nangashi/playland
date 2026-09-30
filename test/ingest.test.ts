import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import sample from "../fixtures/ingest/sample-bundle.json";
import type { ItemDetailResponse, ItemListResponse } from "../src/domain/api";
import { applyBundle, INGEST_WRITABLE_TABLES, planCandidate, previewBundle } from "../src/ingest/apply";
import { validateBundle, type Bundle } from "../src/ingest/bundle";
import { get, parentLogin, seed, sendJson } from "./helpers";

const clone = (): Bundle & Record<string, unknown> => structuredClone(sample) as never;
const apply = (bundle: unknown, accept: number[] = []) =>
  applyBundle(env.DB, bundle, { target: "test", inputHash: "hash", accept: new Set(accept) });
/** 親が承認待ちの画面で公開したのと同じ状態にする */
const publishDrafts = () => env.DB.prepare("UPDATE items SET publish_status = 'published' WHERE publish_status = 'draft'").run();
const errorsOf = (bundle: unknown) => {
  const r = validateBundle(bundle);
  if (r.ok) return [];
  return r.bundle === null ? r.formatErrors : r.issues.flatMap((i) => i.errors);
};

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(seed);

describe("validate（DB を見ない検証）", () => {
  it("サンプルは妥当", () => {
    expect(validateBundle(sample).ok).toBe(true);
  });

  it("イベントは次のフェーズまで受け付けない", () => {
    const b = clone();
    (b.candidates[0]!.item as Record<string, unknown>).kind = "event";
    expect(errorsOf(b).join()).toMatch(/次のフェーズ/);
    const b2 = clone();
    (b2.candidates[0]!.item as Record<string, unknown>).occurrences = [];
    expect(errorsOf(b2).length).toBeGreaterThan(0);
  });

  it("未定義タグは本番に入れず、提案に回すよう求める", () => {
    const b = clone();
    b.candidates[0]!.item.tag_ids = ["programming"];
    expect(errorsOf(b).join()).toMatch(/未定義のタグ「programming」/);
  });

  it("根拠のない判定を拒否（雨・年齢・予約・料金）", () => {
    const b = clone();
    b.candidates[0]!.evidence = [];
    const errors = errorsOf(b).join("\n");
    for (const label of ["雨天対応", "対象年齢", "予約", "料金"]) expect(errors).toMatch(label);
  });

  it("出どころのない座標（推測）を拒否", () => {
    const b = clone();
    Object.assign(b.candidates[1]!.place, { latitude: 35.1, longitude: 139.1, position_accuracy: "exact" });
    expect(errorsOf(b).join()).toMatch(/position_source/);
  });

  it("場所の指定がない・二重指定を拒否", () => {
    const b1 = clone();
    (b1.candidates[0] as Record<string, unknown>).place = null;
    expect(errorsOf(b1).length).toBeGreaterThan(0);
    const b2 = clone();
    b2.candidates[3]!.place.name = "二重";
    expect(errorsOf(b2).join()).toMatch(/どちらか一方/);
  });

  it("javascript: URL・未定義の項目・長すぎる引用を拒否", () => {
    const b1 = clone();
    b1.candidates[0]!.source.url = "javascript:alert(1)";
    expect(errorsOf(b1).length).toBeGreaterThan(0);
    const b2 = clone();
    (b2.candidates[0]!.item as Record<string, unknown>).latitude = 35;
    expect(errorsOf(b2).length).toBeGreaterThan(0);
    const b3 = clone();
    b3.candidates[0]!.evidence[0]!.text = "あ".repeat(301);
    expect(errorsOf(b3).length).toBeGreaterThan(0);
  });

  it("同じバンドル内の出典キーの重複を拒否", () => {
    const b = clone();
    b.candidates[2]!.source.source_key = b.candidates[1]!.source.source_key;
    expect(errorsOf(b).join()).toMatch(/重複/);
  });
});

describe("preview（照合）", () => {
  it("新規・要確認を分ける。同じ URL 上の別のスポットは別の候補", async () => {
    const r = await previewBundle(env.DB, validateBundle(sample).bundle!);
    expect(r.matches.map((m) => m.status)).toEqual(["new", "new", "new", "review"]);
    expect(r.counts).toEqual({ new: 3, existing: 0, review: 1, error: 0 });
  });

  it("タイトルだけの一致は自動統合せず要確認", async () => {
    const b = clone();
    b.candidates[0]!.item.title = "サンプル市 こども科学館"; // 既存と表記ゆれ
    const r = await previewBundle(env.DB, validateBundle(b).bundle!);
    expect(r.matches[0]).toMatchObject({ status: "review" });
    expect(r.matches[0]!.reasons.join()).toMatch(/it-science-spot/);
  });

  it("既存の場所と同名の新しい場所は要確認", async () => {
    const b = clone();
    b.candidates[1]!.place.name = "サンプル森林公園";
    const r = await previewBundle(env.DB, validateBundle(b).bundle!);
    expect(r.matches[1]!.reasons.join()).toMatch(/pl-sample-park/);
  });

  it("存在しない既存場所の指定はエラー", async () => {
    const b = clone();
    b.candidates[3]!.place.existing_place_id = "pl-nowhere";
    const r = await previewBundle(env.DB, validateBundle(b).bundle!);
    expect(r.matches[3]!.status).toBe("error");
  });
});

describe("apply（登録）", () => {
  it("新規だけを登録し、要確認は親が認めるまで登録しない", async () => {
    const r = await apply(sample);
    expect(r.status).toBe("completed");
    expect(r.outcomes.map((o) => o.result)).toEqual(["inserted", "inserted", "inserted", "skipped_review"]);

    // 下書きで登録し、親が公開するまで家族の画面には出さない
    const status = await env.DB.prepare("SELECT publish_status FROM items WHERE id = ?").bind(r.outcomes[0]!.item_id).first();
    expect(status).toEqual({ publish_status: "draft" });
    expect((await get(`/api/items/${r.outcomes[0]!.item_id}`)).status).toBe(404);
    await publishDrafts();
    const detail: ItemDetailResponse = await (await get(`/api/items/${r.outcomes[0]!.item_id}`)).json();
    expect(detail).toMatchObject({
      title: "サンプル市こどもプラネタリウム",
      rain_policy: "ok",
      place: { name: "サンプル市こどもプラネタリウム", address_text: "サンプル市ほしの町4-1", latitude: null },
      reservation_requirement: "not_required",
      price_status: "paid",
    });
    expect(detail.tag_ids).toEqual(["science_museum", "stargazing"]);

    const run = await env.DB.prepare("SELECT * FROM import_runs").first();
    expect(run).toMatchObject({ batch_id: "sample-import-001", status: "completed", new_count: 3, review_count: 1 });
  });

  it("親が認めた要確認の候補は登録できる", async () => {
    expect((await apply(sample)).outcomes[3]!.result).toBe("skipped_review");
    expect((await apply(sample, [3])).outcomes[3]!.result).toBe("inserted");
  });

  it("accept all では要確認も下書きで登録し、照合で見つかった確認事項を出典に残す", async () => {
    const b = clone();
    b.candidates[0]!.place.name = "サンプル森林公園";
    const r = await applyBundle(env.DB, b, { target: "test", inputHash: "hash", accept: "all" });
    expect(r.outcomes.map((o) => o.result)).toEqual(["inserted", "inserted", "inserted", "inserted"]);
    const entry = await env.DB.prepare("SELECT needs_review FROM source_entries WHERE item_id = ?")
      .bind(r.outcomes[0]!.item_id)
      .first<{ needs_review: string }>();
    expect(JSON.parse(entry!.needs_review).join()).toMatch(/既存の場所と同じ名前/);
    const pond = await env.DB.prepare("SELECT needs_review FROM source_entries WHERE item_id = ?")
      .bind(r.outcomes[3]!.item_id)
      .first<{ needs_review: string }>();
    expect(JSON.parse(pond!.needs_review)).toEqual(["開放期間（夏季）の具体的な日付が書かれていない"]);
  });

  it("同じバンドルの再実行で二重登録しない（A16）", async () => {
    await apply(sample);
    const snapshot = async () => ({ items: await count("items"), places: await count("places"), sources: await count("source_entries") });
    const before = await snapshot();
    const again = await apply(sample);
    expect(again.outcomes.slice(0, 3).map((o) => o.result)).toEqual(["skipped_existing", "skipped_existing", "skipped_existing"]);
    expect(await snapshot()).toEqual(before);
  });

  it("DB への書き込みが途中で失敗しても、その候補は丸ごと残らず、再実行で残りを完了できる（A16）", async () => {
    // 1 件目（プラネタリウム）の item_tags 書き込みだけを失敗させる
    await env.DB.prepare(
      `CREATE TRIGGER fail_first_tags BEFORE INSERT ON item_tags
       WHEN NEW.tag_id = 'stargazing'
       BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`,
    ).run();
    const first = await apply(sample);
    expect(first.status).toBe("partial");
    expect(first.outcomes.map((o) => o.result)).toEqual(["error", "inserted", "inserted", "skipped_review"]);
    // 失敗した候補は場所も item も出典も残らない（1 候補 = 1 トランザクション）
    const leftover = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM items WHERE title LIKE '%プラネタリウム%') + (SELECT COUNT(*) FROM places WHERE name LIKE '%プラネタリウム%') AS n",
    ).first<{ n: number }>();
    expect(leftover?.n).toBe(0);
    const run = await env.DB.prepare("SELECT status, error_count, failure_reason FROM import_runs").first<{ failure_reason: string }>();
    expect(run).toMatchObject({ status: "partial", error_count: 1 });
    expect(run?.failure_reason).toMatch(/simulated failure/);

    await env.DB.prepare("DROP TRIGGER fail_first_tags").run();
    const retry = await apply(sample);
    expect(retry.outcomes.map((o) => o.result)).toEqual(["inserted", "skipped_existing", "skipped_existing", "skipped_review"]);
    expect(await count("source_entries")).toBe(3);
  });

  it("親が修正した値は、同じ候補を取り込み直しても変わらない（A14）", async () => {
    const first = await apply(sample);
    const id = first.outcomes[0]!.item_id!;
    const headers = await parentLogin();
    const res = await sendJson(
      "PATCH",
      `/api/admin/items/${id}`,
      { version: 1, rain_policy: "conditional", tag_ids: ["cooking"], experience_tags_status: "assessed" },
      headers,
    );
    expect(res.status).toBe(200);

    // LLM が別の判定で同じ候補を出してきても、出典キーが同じなら更新しない
    const b = clone();
    b.batch_id = "sample-import-002";
    b.candidates[0]!.item.rain_policy = "not_suitable";
    b.candidates[0]!.item.title = "プラネタリウム（改題）";
    const again = await apply(b);
    expect(again.outcomes[0]!.result).toBe("skipped_existing");
    await publishDrafts();
    const detail: ItemDetailResponse = await (await get(`/api/items/${id}`)).json();
    expect(detail).toMatchObject({ rain_policy: "conditional", title: "サンプル市こどもプラネタリウム", tag_ids: ["cooking"] });
  });

  it("既存の場所に候補を足しても、場所・移動設定・保存・家族設定は変わらない（A15 相当）", async () => {
    // 行の内容だけを比べる（D1 の結果に付くメタ情報は DB サイズで変わる）
    const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all([
          rows("SELECT * FROM places WHERE id = 'pl-sample-park'"),
          rows("SELECT * FROM travel_estimates ORDER BY id"),
          rows("SELECT * FROM place_transport_preferences ORDER BY place_id, mode"),
          rows("SELECT * FROM bookmarks ORDER BY item_id"),
          rows("SELECT * FROM family_settings"),
        ]),
      );
    const before = await snapshot();
    const b = clone();
    // 既存場所の住所を持ってきても反映しない
    Object.assign(b.candidates[3]!.place, { address_text: "別の住所" });
    const r = await apply(b, [3]);
    expect(r.outcomes[3]!.result).toBe("inserted");
    expect(await snapshot()).toBe(before);
  });

  it("取り込みの計画は INSERT だけで、許可した表にしか書かない", () => {
    const bundle = validateBundle(sample).bundle!;
    for (const [i, c] of bundle.candidates.entries()) {
      const plan = planCandidate(
        c,
        c.place.existing_place_id ? { kind: "existing", id: c.place.existing_place_id } : { kind: "new", name: c.place.name! },
        { itemId: `i${i}`, placeId: `p${i}`, sourceEntryId: `s${i}` },
        bundle.batch_id,
        "2026-09-29T00:00:00.000Z",
      );
      for (const stmt of plan) {
        const sql = stmt.sql.trim();
        expect(sql).toMatch(/^INSERT INTO /);
        expect(sql).not.toMatch(/\b(UPDATE|DELETE|REPLACE|ON CONFLICT|DROP)\b/i);
        expect(INGEST_WRITABLE_TABLES).toContain(sql.match(/^INSERT INTO (\w+)/)![1]!);
      }
    }
  });

  it("新しい場所には、登録時に自宅からの距離を保存する（日帰り・旅行の判定用）", async () => {
    await env.DB.prepare("UPDATE family_settings SET origin_latitude = 35.68, origin_longitude = 139.76 WHERE id = 1").run();
    const b = clone();
    Object.assign(b.candidates[1]!.place, {
      latitude: 36.68,
      longitude: 139.76,
      position_accuracy: "exact",
      position_source: "source_page",
    });
    const r = await apply(b);
    const itemId = r.outcomes[1]!.item_id!;
    const row = await env.DB.prepare(
      "SELECT p.home_distance_km FROM places p JOIN items i ON i.place_id = p.id WHERE i.id = ?",
    )
      .bind(itemId)
      .first<{ home_distance_km: number | null }>();
    expect(row?.home_distance_km).toBe(111.2);
    await publishDrafts();
    const detail: ItemDetailResponse = await (await get(`/api/items/${itemId}`)).json();
    expect(detail.trip).toBe("trip");
    // 座標のない場所は距離なし
    const noCoords: ItemDetailResponse = await (await get(`/api/items/${r.outcomes[0]!.item_id}`)).json();
    expect(noCoords.trip).toBeNull();
  });

  it("取り込んだ候補は一覧・保存でそのまま使える", async () => {
    const r = await apply(sample);
    const id = r.outcomes[1]!.item_id!;
    await publishDrafts();
    const list: ItemListResponse = await (await get("/api/items?category=park")).json();
    expect(list.items.map((i) => i.id)).toContain(id);
    expect((await sendJson("PUT", `/api/bookmarks/${id}`, undefined)).status).toBe(204);
  });

  it("検証に通らない入力は何も書かない", async () => {
    const b = clone();
    b.candidates[0]!.item.tag_ids = ["not_a_tag"];
    await expect(apply(b)).rejects.toThrow(/検証/);
    expect(await count("source_entries")).toBe(0);
    expect(await count("import_runs")).toBe(0);
  });
});
