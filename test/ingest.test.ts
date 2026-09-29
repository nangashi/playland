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
    const r = validateBundle(sample);
    expect(r.ok).toBe(true);
  });

  it("未定義タグは本番に入れず、提案に回すよう求める", () => {
    const b = clone();
    b.candidates[0]!.item.tag_ids = ["programming"];
    expect(errorsOf(b).join()).toMatch(/未定義のタグ「programming」/);
  });

  it("根拠のない判定を拒否（雨・開催日・年齢）", () => {
    const b = clone();
    b.candidates[0]!.evidence = [];
    const errors = errorsOf(b).join("\n");
    expect(errors).toMatch(/雨天対応/);
    expect(errors).toMatch(/開催日/);
    expect(errors).toMatch(/対象年齢/);
  });

  it("出どころのない座標（推測）を拒否", () => {
    const b = clone();
    Object.assign(b.candidates[1]!.place!, { latitude: 35.1, longitude: 139.1, position_accuracy: "exact" });
    expect(errorsOf(b).join()).toMatch(/position_source/);
  });

  it("開催日の整合（known なのに開催日なし・終了日が先・日付だけに時刻）", () => {
    const b1 = clone();
    b1.candidates[2]!.item.occurrences = [];
    expect(errorsOf(b1).join()).toMatch(/開催日がありません/);
    const b2 = clone();
    b2.candidates[2]!.item.occurrences = [{ start_date: "2026-10-18", end_date: "2026-10-17", precision: "date" } as never];
    expect(errorsOf(b2).length).toBeGreaterThan(0);
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
    b.candidates[3]!.source.source_key = b.candidates[2]!.source.source_key;
    expect(errorsOf(b).join()).toMatch(/重複/);
  });
});

describe("preview（照合）", () => {
  it("新規・要確認を分ける。同じ URL 上の別の企画は別の候補", async () => {
    const r = await previewBundle(env.DB, validateBundle(sample).bundle!);
    expect(r.matches.map((m) => m.status)).toEqual(["new", "new", "new", "review"]);
    expect(r.counts).toEqual({ new: 3, existing: 0, review: 1, error: 0 });
  });

  it("タイトルだけの一致は自動統合せず要確認", async () => {
    const b = clone();
    b.candidates[0]!.item.title = "スライム づくり 教室"; // 既存「スライムづくり教室」と表記ゆれ
    const r = await previewBundle(env.DB, validateBundle(b).bundle!);
    expect(r.matches[0]).toMatchObject({ status: "review" });
    expect(r.matches[0]!.reasons.join()).toMatch(/it-science-slime/);
  });

  it("既存の場所と同名の新しい場所は要確認", async () => {
    const b = clone();
    b.candidates[1]!.place!.name = "サンプル森林公園";
    const r = await previewBundle(env.DB, validateBundle(b).bundle!);
    expect(r.matches[1]!.reasons.join()).toMatch(/pl-sample-park/);
  });

  it("存在しない既存場所の指定はエラー", async () => {
    const b = clone();
    b.candidates[0]!.place!.existing_place_id = "pl-nowhere";
    const r = await previewBundle(env.DB, validateBundle(b).bundle!);
    expect(r.matches[0]!.status).toBe("error");
  });
});

describe("apply（登録）", () => {
  it("新規だけを登録し、要確認は親が認めるまで登録しない", async () => {
    const r = await apply(sample);
    expect(r.status).toBe("completed");
    expect(r.outcomes.map((o) => o.result)).toEqual(["inserted", "inserted", "inserted", "skipped_review"]);

    const robot = r.outcomes[0]!.item_id!;
    const detail: ItemDetailResponse = await (await get(`/api/items/${robot}`)).json();
    expect(detail).toMatchObject({
      rain_policy: "ok",
      place: { id: "pl-sample-science" },
      eligibility: { age_min_kind: "value", age_min: 7, age_max_kind: "unknown" },
      schedule: { occurrence_count: 2 },
    });
    expect(detail.tag_ids).toEqual(["crafting", "experiment", "science_museum"]);
    // 離れた 2 日は別の回
    expect(detail.occurrences.map((o) => o.start_date)).toEqual(["2026-10-11", "2026-10-25"]);
    // 時刻は日本時間として解釈して UTC で保存
    const lib: ItemDetailResponse = await (await get(`/api/items/${r.outcomes[2]!.item_id}`)).json();
    expect(lib.occurrences[0]).toMatchObject({ starts_at: "2026-10-17T01:30:00.000Z", precision: "datetime" });

    const run = await env.DB.prepare("SELECT * FROM import_runs").first();
    expect(run).toMatchObject({ batch_id: "sample-import-001", status: "completed", new_count: 3, review_count: 1 });
  });

  it("親が認めた要確認の候補は登録できる", async () => {
    const b = clone();
    b.candidates[3]!.needs_review = [];
    b.candidates[3]!.item.title = "スライムづくり教室"; // 既存と同名 → 要確認
    const skipped = await apply(b);
    expect(skipped.outcomes[3]!.result).toBe("skipped_review");
    const accepted = await apply(b, [3]);
    expect(accepted.outcomes[3]!.result).toBe("inserted");
  });

  it("同じバンドルの再実行で二重登録しない（A16）", async () => {
    await apply(sample);
    const before = { items: await count("items"), places: await count("places"), sources: await count("source_entries") };
    const again = await apply(sample);
    expect(again.outcomes.slice(0, 3).map((o) => o.result)).toEqual(["skipped_existing", "skipped_existing", "skipped_existing"]);
    expect({ items: await count("items"), places: await count("places"), sources: await count("source_entries") }).toEqual(before);
  });

  it("DB への書き込みが途中で失敗しても、その候補は丸ごと残らず、再実行で残りを完了できる（A16）", async () => {
    // 1 件目（ロボット教室）の item_tags 書き込みだけを失敗させる
    await env.DB.prepare(
      `CREATE TRIGGER fail_robot_tags BEFORE INSERT ON item_tags
       WHEN NEW.tag_id = 'experiment' AND (SELECT title FROM items WHERE id = NEW.item_id) = 'はじめてのロボット教室'
       BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`,
    ).run();
    const first = await apply(sample);
    expect(first.status).toBe("partial");
    expect(first.outcomes.map((o) => o.result)).toEqual(["error", "inserted", "inserted", "skipped_review"]);
    // 失敗した候補は item も出典も残らない（1 候補 = 1 トランザクション）
    const leftover = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE title = 'はじめてのロボット教室'").first<{ n: number }>();
    expect(leftover?.n).toBe(0);
    const run = await env.DB.prepare("SELECT status, error_count, failure_reason FROM import_runs").first<{ failure_reason: string }>();
    expect(run).toMatchObject({ status: "partial", error_count: 1 });
    expect(run?.failure_reason).toMatch(/simulated failure/);

    await env.DB.prepare("DROP TRIGGER fail_robot_tags").run();
    const retry = await apply(sample);
    expect(retry.outcomes.map((o) => o.result)).toEqual(["inserted", "skipped_existing", "skipped_existing", "skipped_review"]);
    expect(await count("source_entries")).toBe(3);
  });

  it("親が修正した値は、同じ候補を取り込み直しても変わらない（A14）", async () => {
    const first = await apply(sample);
    const robot = first.outcomes[0]!.item_id!;
    const headers = await parentLogin();
    const res = await sendJson(
      "PATCH",
      `/api/admin/items/${robot}`,
      { version: 1, rain_policy: "conditional", tag_ids: ["cooking"], experience_tags_status: "assessed" },
      headers,
    );
    expect(res.status).toBe(200);

    // LLM が別の判定で同じ候補を出してきても、出典キーが同じなら更新しない
    const b = clone();
    b.batch_id = "sample-import-002";
    b.candidates[0]!.item.rain_policy = "not_suitable";
    b.candidates[0]!.item.title = "ロボット教室（改題）";
    const again = await apply(b);
    expect(again.outcomes[0]!.result).toBe("skipped_existing");
    const detail: ItemDetailResponse = await (await get(`/api/items/${robot}`)).json();
    expect(detail).toMatchObject({ rain_policy: "conditional", title: "はじめてのロボット教室", tag_ids: ["cooking"] });
  });

  it("既存の会場に新しいイベントを足しても、会場・移動設定・お気に入りは変わらない（A15）", async () => {
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all([
          env.DB.prepare("SELECT * FROM places WHERE id = 'pl-sample-science'").first(),
          env.DB.prepare("SELECT * FROM travel_estimates WHERE place_id = 'pl-sample-science' ORDER BY id").all(),
          env.DB.prepare("SELECT * FROM place_transport_preferences ORDER BY place_id, mode").all(),
          env.DB.prepare("SELECT * FROM favorites ORDER BY profile_id, item_id").all(),
          env.DB.prepare("SELECT * FROM family_settings").all(),
          env.DB.prepare("SELECT * FROM profiles ORDER BY id").all(),
        ]),
      );
    const before = await snapshot();
    const b = clone();
    // 既存場所の住所・座標を持ってきても反映しない
    Object.assign(b.candidates[0]!.place!, { address_text: "別の住所" });
    await apply(b);
    expect(await snapshot()).toBe(before);
  });

  it("取り込みの計画は INSERT だけで、許可した表にしか書かない", () => {
    const bundle = validateBundle(sample).bundle!;
    for (const [i, c] of bundle.candidates.entries()) {
      const plan = planCandidate(
        c,
        c.place?.existing_place_id ? { kind: "existing", id: c.place.existing_place_id } : c.place?.name ? { kind: "new", name: c.place.name } : { kind: "none" },
        { itemId: `i${i}`, placeId: `p${i}`, sourceEntryId: `s${i}`, occurrenceIds: c.item.occurrences.map((_, j) => `o${i}-${j}`) },
        bundle.batch_id,
        "2026-09-29T00:00:00.000Z",
      );
      for (const stmt of plan) {
        const sql = stmt.sql.trim();
        expect(sql).toMatch(/^INSERT INTO /);
        expect(sql).not.toMatch(/\b(UPDATE|DELETE|REPLACE|ON CONFLICT|DROP)\b/i);
        const table = sql.match(/^INSERT INTO (\w+)/)![1]!;
        expect(INGEST_WRITABLE_TABLES).toContain(table);
      }
    }
  });

  it("取り込んだ候補は一覧・地図・お気に入りでそのまま使える", async () => {
    const r = await apply(sample);
    const id = r.outcomes[2]!.item_id!;
    const list: ItemListResponse = await (await get("/api/items?tag_ids=reading")).json();
    expect(list.items.map((i) => i.id)).toContain(id);
    expect((await sendJson("PUT", `/api/profiles/pr-sora/favorites/${id}`, undefined)).status).toBe(204);
  });

  it("検証に通らない入力は何も書かない", async () => {
    const b = clone();
    b.candidates[0]!.item.tag_ids = ["not_a_tag"];
    await expect(apply(b)).rejects.toThrow(/検証/);
    expect(await count("source_entries")).toBe(0);
    expect(await count("import_runs")).toBe(0);
  });
});
