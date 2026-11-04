import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import sampleBundle from "../fixtures/ingest/sample-bundle.json";
import sample from "../fixtures/ingest/sample-retag.json";
import { applyBundle } from "../src/ingest/apply";
import {
  applyRetag,
  buildUndo,
  loadRetagCandidates,
  planRetagStatements,
  previewRetag,
  RETAG_DELETABLE_TABLES,
  RETAG_WRITABLE_TABLES,
  validateRetagBundle,
  type RetagBundle,
} from "../src/ingest/retag";
import { parentLogin, seed, sendJson } from "./helpers";

const clone = (): RetagBundle & Record<string, unknown> => structuredClone(sample) as never;
const parsed = (b: unknown) => validateRetagBundle(b).bundle!;
const apply = (bundle: unknown, accept: number[] | "all" = "all") =>
  applyRetag(env.DB, bundle, { target: "test", inputHash: "hash", accept: accept === "all" ? "all" : new Set(accept) });
const issuesOf = (bundle: unknown) => {
  const r = validateRetagBundle(bundle);
  if (r.bundle === null) return { errors: (r as { formatErrors: string[] }).formatErrors, warnings: [] };
  return { errors: r.issues.flatMap((i) => i.errors), warnings: r.issues.flatMap((i) => i.warnings) };
};
const tagsOf = async (id: string) =>
  (await env.DB.prepare(`SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id`).bind(id).all<{ tag_id: string }>()).results.map(
    (r) => r.tag_id,
  );
const itemRow = (id: string) => env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first<Record<string, unknown>>();
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

let riverParkId: string;

beforeEach(async () => {
  await seed();
  // 出典キーで指す候補（通常の取り込みで登録）と、廃止したタグ vehicles が残る候補を用意する
  await applyBundle(env.DB, sampleBundle, { target: "test", inputHash: "h", accept: "all" });
  const source = await env.DB.prepare(
    `SELECT item_id FROM source_entries WHERE source_id = 'sample-city' AND source_key = 'river-park'`,
  ).first<{ item_id: string }>();
  riverParkId = source!.item_id;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO item_tags (item_id, tag_id) VALUES ('it-park-spot', 'vehicles')`),
    env.DB.prepare(`INSERT INTO item_tags (item_id, tag_id) VALUES ('it-gym-spot', 'vehicles')`),
  ]);
});

describe("retag-export", () => {
  it("今のタグ・未定義のタグ・カテゴリ・出典キーを書き出し、家族の情報を含めない", async () => {
    const items = await loadRetagCandidates(env.DB);
    const park = items.find((i) => i.item_id === "it-park-spot")!;
    expect(park).toMatchObject({
      source_id: null,
      source_key: null,
      version: 1,
      title: "サンプル森林公園",
      tag_ids: ["athletic", "insects", "park", "vehicles"],
      unknown_tag_ids: ["vehicles"],
      categories: ["active", "nature", "animals"],
    });
    const river = items.find((i) => i.item_id === riverParkId)!;
    expect(river).toMatchObject({ source_id: "sample-city", source_key: "river-park" });
    expect(items.map((i) => i.item_id)).not.toContain("it-hidden");
    const text = JSON.stringify(items);
    for (const key of ["bookmark", "hidden_items", "origin_latitude", "profile"]) expect(text).not.toContain(key);
  });
});

describe("retag-validate（DB を見ない検証）", () => {
  it("サンプルは妥当で、remove の未定義タグは警告にとどめる", () => {
    const { errors, warnings } = issuesOf(sample);
    expect(errors).toEqual([]);
    expect(warnings.join()).toMatch(/remove のタグ「vehicles」は未定義/);
  });

  it("add の未定義タグはエラー", () => {
    const b = clone();
    b.entries[0]!.add = ["vehicles"];
    expect(issuesOf(b).errors.join()).toMatch(/未定義のタグ「vehicles」は add に入れられません/);
  });

  it("重複（エントリ・タグ・add と remove の両方）と空はエラー", () => {
    const b = clone();
    b.entries[2]!.item_id = "it-park-spot";
    expect(issuesOf(b).errors.join()).toMatch(/同じ候補（it-park-spot）が重複/);

    const b2 = clone();
    b2.entries[0]!.add = ["nature_observation", "nature_observation"];
    b2.entries[1]!.remove = ["rides"];
    const e2 = issuesOf(b2).errors.join("\n");
    expect(e2).toMatch(/add にタグ「nature_observation」が重複/);
    expect(e2).toMatch(/「rides」が add と remove の両方/);

    const b3 = clone();
    b3.entries[2]!.remove = [];
    expect(issuesOf(b3).errors.join()).toMatch(/add と remove がどちらも空/);

    const b4 = clone();
    b4.entries[0]!.add = [" "];
    expect(issuesOf(b4).errors.join()).toMatch(/空のタグ/);
  });

  it("余分なキー・指定の仕方の誤りはエラー", () => {
    const b = clone();
    (b.entries[0] as Record<string, unknown>).facility_tags_status = "unassessed";
    expect(issuesOf(b).errors.join()).toMatch(/facility_tags_status/);

    const b2 = clone();
    b2.entries[0]!.item_id = "it-park-spot";
    expect(issuesOf(b2).errors.join()).toMatch(/どちらか一方/);

    const b3 = clone();
    delete b3.entries[0]!.source_key;
    expect(issuesOf(b3).errors.join()).toMatch(/両方を書いて/);

    const b4 = clone();
    delete b4.entries[1]!.item_id;
    expect(issuesOf(b4).errors.join()).toMatch(/候補を source_id \+ source_key/);
  });
});

describe("retag-preview", () => {
  it("今のタグ → 変更後のタグ、増減、カテゴリの変化、要約を出す", async () => {
    const { plans, summary } = await previewRetag(env.DB, parsed(clone()));
    const [river, park, gym] = plans;
    expect(river).toMatchObject({
      status: "update",
      item_id: riverParkId,
      before: ["park", "water_play"],
      after: ["nature_observation", "park", "water_play"],
      added: ["nature_observation"],
      removed: [],
      categories_before: ["active"],
      categories_after: ["active", "nature"],
      reason: "川辺で水の生きものを観察できる（自然遊びに入れる）",
    });
    expect(park).toMatchObject({
      status: "update",
      before: ["athletic", "insects", "park", "vehicles"],
      after: ["athletic", "insects", "park", "rides"],
      added: ["rides"],
      removed: ["vehicles"],
      categories_before: ["active", "nature", "animals"],
      categories_after: ["active", "nature", "attractions", "animals"],
    });
    expect(gym).toMatchObject({ status: "update", added: [], removed: ["vehicles"] });
    expect(summary).toEqual({
      entries: 3,
      update: 3,
      unchanged: 0,
      stale: 0,
      mismatch: 0,
      not_found: 0,
      item_tags_added: 2,
      item_tags_removed: 2,
    });
  });

  it("タイトルが違う・版が違う・見つからない候補は適用しない状態で示す", async () => {
    const b = clone();
    b.entries[0]!.title = "別の公園";
    b.entries[1]!.version = 2;
    b.entries[2]!.item_id = "it-nothing";
    const { plans } = await previewRetag(env.DB, parsed(b));
    expect(plans.map((p) => p.status)).toEqual(["mismatch", "stale", "not_found"]);
  });

  it("タイトルの空白・全角半角の違いは同じとみなす", async () => {
    const b = clone();
    b.entries[1]!.title = "  サンプル森林公園 ";
    const { plans } = await previewRetag(env.DB, parsed(b));
    expect(plans[1]!.status).toBe("update");
  });

  it("分類が空になる場合は警告を出す", async () => {
    const b = clone();
    b.entries[2]!.remove = ["vehicles", "climbing"];
    const { plans } = await previewRetag(env.DB, parsed(b));
    expect(plans[2]!.warnings.join()).toMatch(/体験タグが空になります（判定状況 experience_tags_status=assessed は変えません）/);
    // 施設分類が残っている・体験タグが残る候補には出さない
    expect(plans[1]!.warnings).toEqual([]);
  });
});

describe("retag-apply", () => {
  it("タグと版・更新日時だけを書き換え、他の項目・判定状況・親の確認日時は変えない", async () => {
    await env.DB.prepare(`UPDATE items SET parent_reviewed_at = '2026-10-01T00:00:00.000Z' WHERE id = 'it-park-spot'`).run();
    const before = (await itemRow("it-park-spot"))!;
    const placesBefore = await env.DB.prepare(`SELECT * FROM places ORDER BY id`).all();
    const sourcesBefore = await env.DB.prepare(`SELECT * FROM source_entries ORDER BY id`).all();
    const othersBefore = await env.DB.prepare(`SELECT * FROM items WHERE id NOT IN ('it-park-spot', 'it-gym-spot', ?) ORDER BY id`)
      .bind(riverParkId)
      .all();

    const result = await apply(clone());
    expect(result.status).toBe("completed");
    expect(result.outcomes.map((o) => o.result)).toEqual(["updated", "updated", "updated"]);

    const after = (await itemRow("it-park-spot"))!;
    const { version: v0, updated_at: u0, ...restBefore } = before;
    const { version: v1, updated_at: u1, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect([v0, v1]).toEqual([1, 2]);
    expect(u1).not.toBe(u0);

    expect(await tagsOf("it-park-spot")).toEqual(["athletic", "insects", "park", "rides"]);
    expect(await tagsOf("it-gym-spot")).toEqual(["climbing", "sports_facility"]);
    expect(await tagsOf(riverParkId)).toEqual(["nature_observation", "park", "water_play"]);

    expect((await env.DB.prepare(`SELECT * FROM places ORDER BY id`).all()).results).toEqual(placesBefore.results);
    expect((await env.DB.prepare(`SELECT * FROM source_entries ORDER BY id`).all()).results).toEqual(sourcesBefore.results);
    const othersAfter = await env.DB.prepare(`SELECT * FROM items WHERE id NOT IN ('it-park-spot', 'it-gym-spot', ?) ORDER BY id`)
      .bind(riverParkId)
      .all();
    expect(othersAfter.results).toEqual(othersBefore.results);
  });

  it("分類が空になっても判定状況は変えない", async () => {
    const b = clone();
    b.entries[2]!.remove = ["vehicles", "climbing"];
    const result = await apply(b, [2]);
    expect(result.outcomes[2]!.warnings.join()).toMatch(/体験タグが空/);
    expect(await itemRow("it-gym-spot")).toMatchObject({ experience_tags_status: "assessed", version: 2 });
    expect(await tagsOf("it-gym-spot")).toEqual(["sports_facility"]);
  });

  it("変更履歴と実行記録を残す", async () => {
    const result = await apply(clone());
    const audit = await env.DB.prepare(
      `SELECT target_type, target_id, action, actor, version_after, changed_fields FROM audit_log ORDER BY id`,
    ).all();
    expect(audit.results).toEqual(
      [riverParkId, "it-park-spot", "it-gym-spot"].map((id) => ({
        target_type: "item",
        target_id: id,
        action: "update",
        actor: "ingest:retag:sample-retag-001",
        version_after: 2,
        changed_fields: '["tag_ids"]',
      })),
    );
    const run = await env.DB.prepare(`SELECT * FROM import_runs WHERE id = ?`).bind(result.run_id).first();
    expect(run).toMatchObject({ batch_id: "sample-retag-001", status: "completed", new_count: 3, error_count: 0, failure_reason: null });
  });

  it("承認した番号だけを適用する", async () => {
    const result = await apply(clone(), [1]);
    expect(result.outcomes.map((o) => o.result)).toEqual(["skipped_not_accepted", "updated", "skipped_not_accepted"]);
    expect(await tagsOf("it-gym-spot")).toContain("vehicles");
    expect((await itemRow(riverParkId))!.version).toBe(1);
  });

  it("再実行では全件「変更なし」になり、何も書かない", async () => {
    await apply(clone());
    const audits = await count("audit_log");
    const second = await apply(clone());
    expect(second.status).toBe("completed");
    expect(second.outcomes.map((o) => o.result)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(await count("audit_log")).toBe(audits);
    expect((await itemRow("it-park-spot"))!.version).toBe(2);
    const { summary } = await previewRetag(env.DB, parsed(clone()));
    expect(summary).toMatchObject({ entries: 3, unchanged: 3, update: 0, item_tags_added: 0, item_tags_removed: 0 });
  });

  it("書き出し後に親が編集した候補は適用しない（一部失敗は partial）", async () => {
    const headers = await parentLogin();
    const res = await sendJson("PATCH", "/api/admin/items/it-gym-spot", { version: 1, rain_policy: "ok" }, headers);
    expect(res.status).toBe(200);
    const result = await apply(clone());
    expect(result.outcomes.map((o) => o.result)).toEqual(["updated", "updated", "skipped_stale"]);
    expect(result.status).toBe("partial");
    expect(await tagsOf("it-gym-spot")).toContain("vehicles");
    const run = await env.DB.prepare(`SELECT status, review_count, failure_reason FROM import_runs WHERE id = ?`)
      .bind(result.run_id)
      .first<{ status: string; review_count: number; failure_reason: string }>();
    expect(run).toMatchObject({ status: "partial", review_count: 1 });
    expect(run!.failure_reason).toMatch(/#2/);
  });

  it("タイトル不一致・見つからない候補だけなら failed", async () => {
    const b = clone();
    b.entries[0]!.title = "別の公園";
    b.entries[1]!.item_id = "it-nothing";
    const result = await apply(b, [0, 1]);
    expect(result.outcomes.map((o) => o.result)).toEqual(["skipped_mismatch", "error", "skipped_not_accepted"]);
    expect(result.status).toBe("failed");
    expect(await count("audit_log")).toBe(0);
  });

  it("戻し用の入力は add と remove を入れ替え、適用後の版を持つ（未定義のタグは戻さない）", async () => {
    const original = parsed(clone());
    const result = await apply(original);
    const undo = buildUndo(original, result, "2026-11-03T01:00:00.000Z");
    expect(undo.omitted).toEqual([
      { index: 1, ref: "it-park-spot", tags: ["vehicles"] },
      { index: 2, ref: "it-gym-spot", tags: ["vehicles"] },
    ]);
    expect(validateRetagBundle(undo.bundle).ok).toBe(true);
    expect(undo.bundle!.batch_id).toBe("undo-sample-retag-001");
    expect(undo.bundle!.entries).toEqual([
      expect.objectContaining({ source_id: "sample-city", source_key: "river-park", version: 2, add: [], remove: ["nature_observation"] }),
      expect.objectContaining({ item_id: "it-park-spot", version: 2, add: [], remove: ["rides"] }),
    ]);
    // 戻し用を適用すると、定義済みのタグは元に戻る
    const undone = await apply(undo.bundle);
    expect(undone.status).toBe("completed");
    expect(await tagsOf(riverParkId)).toEqual(["park", "water_play"]);
    expect(await tagsOf("it-park-spot")).toEqual(["athletic", "insects", "park"]);
  });

  it("SQL は許可した表だけに書き、DELETE は外すタグの行だけ", async () => {
    const b = parsed(clone());
    const { plans } = await previewRetag(env.DB, b);
    for (const plan of plans) {
      const stmts = planRetagStatements(plan, plan.current_version!, b.batch_id, "2026-11-03T00:00:00.000Z");
      for (const { sql } of stmts) {
        expect(sql).not.toMatch(/\b(DROP|REPLACE|ALTER)\b/i);
        expect(sql).not.toMatch(/parent_reviewed_at|_tags_status|title|child_description|price_/);
        const m = sql.trim().match(/^(INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM) (\w+)/)!;
        expect(RETAG_WRITABLE_TABLES).toContain(m[2]);
        if (m[1] === "DELETE FROM") {
          expect(RETAG_DELETABLE_TABLES).toContain(m[2]);
          expect(sql).toMatch(/WHERE item_id = \? AND tag_id = \?/);
        }
        if (m[1] === "UPDATE") expect(sql).toMatch(/^UPDATE items SET version = version \+ 1, updated_at = \? WHERE/);
      }
    }
  });
});
