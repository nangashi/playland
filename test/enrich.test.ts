import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import sampleBundle from "../fixtures/ingest/sample-bundle.json";
import sample from "../fixtures/ingest/sample-enrich.json";
import { applyBundle } from "../src/ingest/apply";
import {
  applyEnrich,
  ENRICH_WRITABLE_TABLES,
  loadIncomplete,
  planEnrichStatements,
  previewEnrich,
  validateEnrichBundle,
  type EnrichBundle,
} from "../src/ingest/enrich";
import { parentLogin, seed, sendJson } from "./helpers";

const clone = (): EnrichBundle & Record<string, unknown> => structuredClone(sample) as never;
const parsed = (b: unknown) => validateEnrichBundle(b).bundle!;
const apply = (bundle: unknown, accept: number[] | "all" = "all") =>
  applyEnrich(env.DB, bundle, { target: "test", inputHash: "hash", accept: accept === "all" ? "all" : new Set(accept) });
const errorsOf = (bundle: unknown) => {
  const r = validateEnrichBundle(bundle);
  if (r.ok) return [];
  return r.bundle === null ? r.formatErrors : r.issues.flatMap((i) => i.errors);
};

interface Row {
  version: number;
  rain_policy: string;
  official_url: string | null;
  age_min_kind: string;
  age_min: number | null;
  price_status: string;
  price_text: string | null;
  facility_tags_status: string;
  experience_tags_status: string;
  parent_reviewed_at: string | null;
}
const itemRow = (id: string) => env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first<Row>();

beforeEach(seed);

describe("enrich-export（空欄の残る候補）", () => {
  it("空欄の項目を挙げ、家族の情報を含めない", async () => {
    const items = await loadIncomplete(env.DB);
    const gym = items.find((i) => i.item_id === "it-gym-spot")!;
    expect(gym.version).toBe(1);
    expect(gym.missing).toEqual(expect.arrayContaining(["rain_policy", "official_url", "place.address_text", "age_max"]));
    // 値のある項目・判定済みのタグは空欄に数えない
    for (const f of ["child_description", "age_min", "facility_tags", "eligibility_raw_text"]) expect(gym.missing).not.toContain(f);
    expect(gym.current.tag_ids).toEqual(["climbing", "sports_facility"]);
    // 非表示にした候補は対象外
    expect(items.map((i) => i.item_id)).not.toContain("it-hidden");
    const text = JSON.stringify(items);
    for (const key of ["bookmark", "hidden_items", "origin_latitude", "profile"]) expect(text).not.toContain(key);
  });

  it("写真の枚数（候補と場所の写真）を出し、空欄がなくても写真のない候補は書き出す", async () => {
    await env.DB.batch([
      env.DB.prepare(`UPDATE items SET official_url = 'https://example.com/kids', guardian_rule = 'not_required',
                        sibling_rule = 'allowed', recommended_age_min = 0, recommended_age_max = 12,
                        reservation_note = 'なし', price_text = '無料' WHERE id = 'it-kids-spot'`),
      env.DB.prepare(`INSERT INTO media (id, r2_key, place_id, kind, content_type, byte_size, sha256, created_at)
                      VALUES ('m-place', 'media/m-place', 'pl-sample-science', 'venue', 'image/png', 1, 'x', 'x')`),
    ]);
    const items = await loadIncomplete(env.DB);
    const kids = items.find((i) => i.item_id === "it-kids-spot")!;
    expect(kids).toMatchObject({ missing: [], photo_count: 0 });
    expect(items.find((i) => i.item_id === "it-science-spot")?.photo_count).toBe(1);
    expect(JSON.stringify(kids.current)).not.toContain("photo_count");
  });

  it("既定では通常の取り込みで登録した候補を除き、--all で含める", async () => {
    const result = await applyBundle(env.DB, sampleBundle, { target: "test", inputHash: "h", accept: new Set([0, 1, 2, 3]) });
    const ingested = result.outcomes.find((o) => o.result === "inserted")!.item_id!;
    expect((await loadIncomplete(env.DB)).map((i) => i.item_id)).not.toContain(ingested);
    const all = await loadIncomplete(env.DB, { all: true });
    expect(all.find((i) => i.item_id === ingested)?.from_ingest).toBe(true);
  });
});

describe("enrich-validate（DB を見ない検証）", () => {
  it("サンプルは妥当", () => {
    expect(errorsOf(sample)).toEqual([]);
  });

  it("unknown は書かせない（分からなければ省略）", () => {
    const b = clone();
    (b.updates[0]!.item as Record<string, unknown>).guardian_rule = "unknown";
    expect(errorsOf(b).join()).toMatch(/省略/);
  });

  it("根拠のない補足を拒否（雨・年齢・料金・住所）", () => {
    const b = clone();
    b.updates[0]!.evidence = [];
    b.updates[1]!.evidence = [];
    const errors = errorsOf(b).join("\n");
    for (const label of ["雨天対応", "対象年齢", "同伴・参加条件", "住所", "料金"]) expect(errors).toMatch(label);
  });

  it("未定義のタグ・分類違いのタグを拒否", () => {
    const b = clone();
    b.updates[0]!.item.facility_tag_ids = ["programming", "crafting"];
    const errors = errorsOf(b).join("\n");
    expect(errors).toMatch(/未定義のタグ「programming」/);
    expect(errors).toMatch(/「crafting」は experience_tag_ids/);
  });

  it("年齢の種別と値が合わないものを拒否", () => {
    const b = clone();
    b.updates[0]!.item.age_max_kind = "value";
    expect(errorsOf(b).join()).toMatch(/age_max_kind と age_max/);
    const b2 = clone();
    b2.updates[0]!.item.age_min = 3;
    expect(errorsOf(b2).join()).toMatch(/age_min には age_min_kind/);
  });

  it("同じ候補の重複と、何も補足しない更新を拒否", () => {
    const b = clone();
    b.updates[1]!.item_id = "it-gym-spot";
    expect(errorsOf(b).join()).toMatch(/重複/);
    const b2 = clone();
    b2.updates[1]!.item = {};
    b2.updates[1]!.evidence = [];
    expect(errorsOf(b2).join()).toMatch(/補足する項目がありません/);
  });
});

describe("enrich-preview", () => {
  it("空欄は埋め、値がある項目は変えないと示す", async () => {
    const { plans } = await previewEnrich(env.DB, parsed(clone()));
    const [gym, science, farm] = plans;
    expect(gym!.status).toBe("update");
    expect(gym!.fills.map((f) => f.field)).toEqual(["official_url", "rain_policy", "guardian_rule", "age_max", "place.address_text"]);
    expect(farm!.fills).toEqual([
      { field: "child_description", value: "ヤギやウサギにえさをあげられる小さな牧場。" },
      { field: "experience_tags", value: ["animals"] },
    ]);
    expect(science!.status).toBe("update");
    expect(science!.fills.map((f) => f.field)).toEqual(["price_text", "price_status"]);
    expect(science!.kept).toEqual([{ field: "rain_policy", current: "ok" }]);
  });

  it("書き出し後に版が変わった候補は stale", async () => {
    const b = clone();
    b.updates[0]!.version = 2;
    const { plans } = await previewEnrich(env.DB, parsed(b));
    expect(plans[0]!.status).toBe("stale");
  });
});

describe("enrich-apply", () => {
  it("承認した番号の空欄だけを埋め、親の確認日時は変えない", async () => {
    const before = await itemRow("it-science-spot");
    const result = await apply(clone(), [0]);
    expect(result.outcomes.map((o) => o.result)).toEqual(["updated", "skipped_not_accepted", "skipped_not_accepted"]);
    expect(await itemRow("it-science-spot")).toEqual(before);

    const gym = (await itemRow("it-gym-spot"))!;
    expect(gym).toMatchObject({
      version: 2,
      rain_policy: "ok",
      official_url: "https://example.com/gym",
      age_min_kind: "value",
      age_min: 4,
      age_max_kind: "none",
      guardian_rule: "required",
      parent_reviewed_at: null,
    });
    const place = await env.DB.prepare(`SELECT address_text, latitude, version FROM places WHERE id = 'pl-sample-gym'`).first();
    expect(place).toEqual({ address_text: "サンプル市いわ町7-7", latitude: null, version: 2 });

    const source = await env.DB.prepare(`SELECT source_id, source_key, evidence FROM source_entries WHERE item_id = 'it-gym-spot'`).first<{
      source_id: string;
      source_key: string;
      evidence: string;
    }>();
    expect(source?.source_key).toBe("enrich:sample-enrich-001:it-gym-spot");
    expect(JSON.parse(source!.evidence)).toHaveLength(4);
    const audit = await env.DB.prepare(`SELECT target_type, actor FROM audit_log ORDER BY id`).all();
    expect(audit.results).toEqual([
      { target_type: "place", actor: "ingest:enrich:sample-enrich-001" },
      { target_type: "item", actor: "ingest:enrich:sample-enrich-001" },
    ]);
  });

  it("値のある項目（親の入力など）は上書きしない", async () => {
    await apply(clone(), [1]);
    const science = (await itemRow("it-science-spot"))!;
    expect(science.rain_policy).toBe("ok");
    expect(science.price_status).toBe("paid");
    expect(science.price_text).toBe("大人500円・中学生以下無料");
  });

  it("未判定の分類だけタグを付けて判定済みにする", async () => {
    await apply(clone(), [2]);
    const farm = (await itemRow("it-farm-spot"))!;
    expect(farm).toMatchObject({ facility_tags_status: "assessed", experience_tags_status: "assessed" });
    const tags = await env.DB.prepare(`SELECT tag_id FROM item_tags WHERE item_id = 'it-farm-spot' ORDER BY tag_id`).all();
    expect(tags.results).toEqual([{ tag_id: "animals" }, { tag_id: "farm" }]);
  });

  it("書き出し後に親が編集した候補は登録しない", async () => {
    const headers = await parentLogin();
    const res = await sendJson("PATCH", "/api/admin/items/it-gym-spot", { version: 1, rain_policy: "not_suitable" }, headers);
    expect(res.status).toBe(200);
    const result = await apply(clone(), [0]);
    expect(result.outcomes[0]!.result).toBe("skipped_stale");
    expect((await itemRow("it-gym-spot"))!.rain_policy).toBe("not_suitable");
  });

  it("再実行しても二重に登録しない", async () => {
    await apply(clone());
    const b = clone();
    const second = await apply(b);
    expect(second.outcomes.map((o) => o.result)).toEqual(["skipped_stale", "skipped_stale", "skipped_stale"]);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM source_entries`).first<{ n: number }>();
    expect(n?.n).toBe(3);
  });

  it("既存の値と矛盾する年齢は登録しない", async () => {
    // 下限 4 歳が入っている候補に、上限 3 歳を補足しようとする
    const b = clone();
    Object.assign(b.updates[0]!.item, { age_max_kind: "value", age_max: 3 });
    const result = await apply(b, [0]);
    expect(result.outcomes[0]!.result).toBe("skipped_conflict");
    expect((await itemRow("it-gym-spot"))!.version).toBe(1);
  });

  it("書き込むのは補足用の表だけで、DELETE しない", async () => {
    const b = parsed(clone());
    const { plans } = await previewEnrich(env.DB, b);
    const row = await env.DB.prepare(
      `SELECT i.*, p.name AS place_name, p.address_text AS place_address_text FROM items i LEFT JOIN places p ON p.id = i.place_id WHERE i.id = ?`,
    )
      .bind("it-gym-spot")
      .first();
    const stmts = planEnrichStatements(b.updates[0]!, plans[0]!, row as never, { sourceEntryId: "s" }, b.batch_id, "2026-09-30T00:00:00.000Z");
    for (const { sql } of stmts) {
      expect(sql).not.toMatch(/\b(DELETE|DROP|REPLACE)\b/i);
      expect(sql).not.toMatch(/parent_reviewed_at|latitude|position_source/);
      const table = sql.trim().match(/^(?:INSERT(?: OR IGNORE)? INTO|UPDATE) (\w+)/)![1]!;
      expect(ENRICH_WRITABLE_TABLES).toContain(table);
    }
  });
});
