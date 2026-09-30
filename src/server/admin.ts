import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import {
  ITEM_PATCH_COLUMNS,
  MAX_MEDIA_BYTES,
  PLACE_PATCH_COLUMNS,
  itemCreateSchema,
  itemPatchSchema,
  mediaUploadFieldsSchema,
  pinSchema,
  placePatchSchema,
  settingsPatchSchema,
  transportPatchSchema,
} from "../domain/admin";
import type {
  AdminItemResponse,
  AdminPlaceListResponse,
  AdminPlaceResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
} from "../domain/api";
import { sha256Hex, sniffImageType } from "../domain/image";
import { idSchema } from "../domain/model";
import { endSession, identityKey, readSession, requireParent, verifyPinAndStartSession } from "./parent";
import * as repo from "./repo";
import type { AppEnv } from "./types";

export const adminApi = new Hono<AppEnv>();

adminApi.use("*", bodyLimit({ maxSize: MAX_MEDIA_BYTES + 64 * 1024, onError: (c) => c.json({ error: "too large" }, 413) }));

// ---- 親セッション ----

adminApi.get("/session", async (c) => {
  const expires = await readSession(c);
  const body: AdminSessionResponse = { active: expires !== null, expires_at: expires?.toISOString() ?? null };
  return c.json(body);
});

adminApi.post("/session", async (c) => {
  const input = await parseJson(c, pinSchema);
  if (!input) return c.json({ error: "invalid" }, 400);
  const result = await verifyPinAndStartSession(c, input.pin);
  if (result.ok) {
    const body: AdminSessionResponse = { active: true, expires_at: result.expiresAt.toISOString() };
    return c.json(body);
  }
  if (result.reason === "locked") return c.json({ error: "too many attempts" }, 429);
  if (result.reason === "unavailable") return c.json({ error: "unavailable" }, 503);
  return c.json({ error: "invalid pin" }, 401);
});

adminApi.delete("/session", (c) => {
  endSession(c);
  return c.body(null, 204);
});

// ここから先は親セッションが必要
adminApi.use("*", requireParent());

// ---- 候補 ----

adminApi.get("/items/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const db = c.env.DB;
  const item = await repo.getItem(db, id.data);
  if (!item) return notFound(c);
  const [tags, place, media] = await Promise.all([
    repo.listItemTags(db, item.id),
    item.place_id ? repo.getPlace(db, item.place_id) : null,
    repo.listMediaFor(db, { itemId: item.id, placeId: null }, true),
  ]);
  const body: AdminItemResponse = {
    item,
    tag_ids: tags.map((t) => t.tag_id).sort(),
    place,
    media,
  };
  return c.json(body);
});

/** 手動追加（常設スポット）。URL とタイトルと場所だけでも作れる。分からない項目は unknown のまま */
adminApi.post("/items", async (c) => {
  const input = await parseJson(c, itemCreateSchema);
  if (!input) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const itemId = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  let placeId = input.place_id ?? null;
  if (input.new_place_name) {
    placeId = crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          `INSERT INTO places (id, name, position_accuracy, initialized_at, created_at, updated_at)
           VALUES (?, ?, 'unknown', ?, ?, ?)`,
        )
        .bind(placeId, input.new_place_name, now, now, now),
      audit(db, c, "place", placeId, "create", 1, ["name"], now),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO items (id, kind, place_id, title, official_url, publish_status,
                            initialized_at, parent_reviewed_at, created_at, updated_at)
         VALUES (?, 'spot', ?, ?, ?, 'published', ?, ?, ?, ?)`,
      )
      .bind(itemId, placeId, input.title, input.official_url ?? null, now, now, now, now),
    audit(db, c, "item", itemId, "create", 1, ["title", "official_url", "place_id"], now),
  );
  const res = await runWrite(c, () => db.batch(stmts));
  if (res) return res;
  return c.json({ id: itemId, place_id: placeId }, 201);
});

adminApi.patch("/items/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const input = await parseJson(c, itemPatchSchema);
  if (!input) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const current = await repo.getItem(db, id.data);
  if (!current) return notFound(c);

  const now = new Date().toISOString();
  const { version } = input;
  // 版が一致するときだけ子テーブルを書き換える。batch は 1 トランザクションで実行される
  const guard = `EXISTS (SELECT 1 FROM items WHERE id = ? AND version = ?)`;
  const stmts: D1PreparedStatement[] = [];

  if (input.tag_ids) {
    stmts.push(db.prepare(`DELETE FROM item_tags WHERE item_id = ? AND ${guard}`).bind(id.data, id.data, version));
    for (const tagId of input.tag_ids) {
      stmts.push(
        db
          .prepare(`INSERT INTO item_tags (item_id, tag_id) SELECT ?, ? WHERE ${guard}`)
          .bind(id.data, tagId, id.data, version),
      );
    }
  }
  const changed = Object.keys(input).filter((k) => k !== "version");
  stmts.push(auditGuarded(db, c, "item", id.data, version, changed, now, guard, [id.data, version]));

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const col of ITEM_PATCH_COLUMNS) {
    if (input[col] !== undefined) {
      sets.push(`${col} = ?`);
      values.push(input[col]);
    }
  }
  stmts.push(
    db
      .prepare(
        `UPDATE items SET ${[...sets, "parent_reviewed_at = ?", "updated_at = ?", "version = version + 1"].join(", ")}
          WHERE id = ? AND version = ?`,
      )
      .bind(...values, now, now, id.data, version),
  );

  let results: D1Result[] = [];
  const res = await runWrite(c, async () => {
    results = await db.batch(stmts);
  });
  if (res) return res;
  if ((results.at(-1)?.meta.changes ?? 0) === 0) return conflict(c, (await repo.getItem(db, id.data))?.version);
  return c.json({ id: id.data, version: version + 1 });
});

// ---- 場所 ----

adminApi.get("/places", async (c) => {
  const places = await repo.listPlaces(c.env.DB);
  const body: AdminPlaceListResponse = { places: places.map(({ id, name }) => ({ id, name })) };
  return c.json(body);
});

adminApi.get("/places/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const db = c.env.DB;
  const [place, settings, preferences, estimates] = await Promise.all([
    repo.getPlace(db, id.data),
    repo.getSettings(db),
    repo.listTransportPreferences(db, id.data),
    repo.listTravelEstimates(db, id.data),
  ]);
  if (!place) return notFound(c);
  const body: AdminPlaceResponse = {
    place,
    origin:
      settings.origin_latitude !== null && settings.origin_longitude !== null
        ? { latitude: settings.origin_latitude, longitude: settings.origin_longitude }
        : null,
    origin_version: settings.origin_version,
    preferences,
    estimates: estimates.filter((e) => e.origin_version === settings.origin_version),
  };
  return c.json(body);
});

adminApi.patch("/places/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const input = await parseJson(c, placePatchSchema);
  if (!input) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const patch = { ...input };
  // 座標を消したら精度も不明に戻す（座標なしで exact と表示しない）
  if (patch.latitude === null && patch.position_accuracy === undefined) patch.position_accuracy = "unknown";

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const col of PLACE_PATCH_COLUMNS) {
    if (patch[col] !== undefined) {
      sets.push(`${col} = ?`);
      values.push(patch[col]);
    }
  }
  // 親が座標を指定・消去したら、以後の住所検索で上書きしない
  if (patch.latitude !== undefined) {
    sets.push("position_source = 'parent'", "position_note = NULL");
  }
  const guard = `EXISTS (SELECT 1 FROM places WHERE id = ? AND version = ?)`;
  const changed = Object.keys(input).filter((k) => k !== "version");
  const stmts = [
    auditGuarded(db, c, "place", id.data, input.version, changed, now, guard, [id.data, input.version]),
    db
      .prepare(
        `UPDATE places SET ${[...sets, "updated_at = ?", "version = version + 1"].join(", ")}
          WHERE id = ? AND version = ?`,
      )
      .bind(...values, now, id.data, input.version),
  ];
  let results: D1Result[] = [];
  const res = await runWrite(c, async () => {
    results = await db.batch(stmts);
  });
  if (res) return res;
  if ((results.at(-1)?.meta.changes ?? 0) === 0) return placeConflict(c, db, id.data);
  return c.json({ id: id.data, version: input.version + 1 });
});

/** 移動手段の表示方針と、親が確認した所要時間（現在の出発地点の版に紐付ける） */
adminApi.patch("/places/:id/transport", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const input = await parseJson(c, transportPatchSchema);
  if (!input) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const { origin_version } = await repo.getSettings(db);
  const guard = `EXISTS (SELECT 1 FROM places WHERE id = ? AND version = ?)`;
  const g = [id.data, input.version];
  const stmts: D1PreparedStatement[] = [];

  for (const p of input.preferences ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO place_transport_preferences (place_id, mode, visibility, note, updated_at)
           SELECT ?, ?, ?, ?, ? WHERE ${guard}
           ON CONFLICT (place_id, mode) DO UPDATE SET
             visibility = excluded.visibility, note = excluded.note, updated_at = excluded.updated_at`,
        )
        .bind(id.data, p.mode, p.visibility, p.note ?? null, now, ...g),
    );
  }
  for (const e of input.estimates ?? []) {
    if (e.route_status === "clear") {
      stmts.push(
        db
          .prepare(
            `DELETE FROM travel_estimates
              WHERE place_id = ? AND origin_version = ? AND mode = ? AND source = 'manual' AND ${guard}`,
          )
          .bind(id.data, origin_version, e.mode, ...g),
      );
      continue;
    }
    const estimated = e.route_status === "estimated" ? e : null;
    // 経路サービスの値（source=api）は別行のまま残し、親の値だけを書き換える
    stmts.push(
      db
        .prepare(
          `INSERT INTO travel_estimates
             (id, place_id, origin_version, mode, source, route_status, minutes, basis,
              walk_minutes, transfers, note, observed_at)
           SELECT ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
           ON CONFLICT (place_id, origin_version, mode, source) DO UPDATE SET
             route_status = excluded.route_status, minutes = excluded.minutes, basis = excluded.basis,
             walk_minutes = excluded.walk_minutes, transfers = excluded.transfers,
             note = excluded.note, observed_at = excluded.observed_at`,
        )
        .bind(
          crypto.randomUUID(),
          id.data,
          origin_version,
          e.mode,
          e.route_status,
          estimated?.minutes ?? null,
          estimated?.basis ?? null,
          estimated?.walk_minutes ?? null,
          estimated?.transfers ?? null,
          e.note ?? null,
          now,
          ...g,
        ),
    );
  }
  const changed = [
    ...(input.preferences ?? []).map((p) => `transport.${p.mode}.visibility`),
    ...(input.estimates ?? []).map((e) => `transport.${e.mode}.estimate`),
  ];
  stmts.push(
    auditGuarded(db, c, "place", id.data, input.version, changed, now, guard, g),
    db
      .prepare(`UPDATE places SET updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .bind(now, ...g),
  );
  let results: D1Result[] = [];
  const res = await runWrite(c, async () => {
    results = await db.batch(stmts);
  });
  if (res) return res;
  if ((results.at(-1)?.meta.changes ?? 0) === 0) return placeConflict(c, db, id.data);
  return c.json({ id: id.data, version: input.version + 1 });
});

// ---- 家族設定 ----

adminApi.get("/settings", async (c) => {
  const body: AdminSettingsResponse = await repo.getSettings(c.env.DB);
  return c.json(body);
});

adminApi.patch("/settings", async (c) => {
  const input = await parseJson(c, settingsPatchSchema);
  if (!input) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const current = await repo.getSettings(db);
  const now = new Date().toISOString();
  const originMoved =
    input.origin_latitude !== undefined &&
    (input.origin_latitude !== current.origin_latitude || input.origin_longitude !== current.origin_longitude);
  const bump = originMoved || input.bump_origin_version === true ? 1 : 0;

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const col of ["origin_label", "origin_latitude", "origin_longitude", "bicycle_max_minutes"] as const) {
    if (input[col] !== undefined) {
      sets.push(`${col} = ?`);
      values.push(input[col]);
    }
  }
  const guard = `EXISTS (SELECT 1 FROM family_settings WHERE id = 1 AND version = ?)`;
  // 自宅の座標の値は監査ログに残さない（項目名だけ）
  const changed = Object.keys(input).filter((k) => k !== "version");
  const stmts = [
    auditGuarded(db, c, "settings", "family", input.version, changed, now, guard, [input.version]),
    db
      .prepare(
        `UPDATE family_settings
            SET ${[...sets, "origin_version = origin_version + ?", "updated_at = ?", "version = version + 1"].join(", ")}
          WHERE id = 1 AND version = ?`,
      )
      .bind(...values, bump, now, input.version),
  ];
  let results: D1Result[] = [];
  const res = await runWrite(c, async () => {
    results = await db.batch(stmts);
  });
  if (res) return res;
  if ((results.at(-1)?.meta.changes ?? 0) === 0) return conflict(c, (await repo.getSettings(db)).version);
  const body: AdminSettingsResponse = await repo.getSettings(db);
  return c.json(body);
});

// ---- 写真 ----

adminApi.post("/media", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "invalid" }, 400);
  }
  const file = form.get("file");
  const fields = mediaUploadFieldsSchema.safeParse({
    item_id: form.get("item_id") || undefined,
    place_id: form.get("place_id") || undefined,
    kind: form.get("kind"),
    source_url: form.get("source_url") ?? undefined,
    credit: form.get("credit") ?? undefined,
    license_note: form.get("license_note") ?? undefined,
  });
  if (!(file instanceof File) || !fields.success) return c.json({ error: "invalid" }, 400);
  if (file.size === 0 || file.size > MAX_MEDIA_BYTES) return c.json({ error: "too large" }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) return c.json({ error: "unsupported image" }, 415);

  const db = c.env.DB;
  const target = fields.data;
  const exists = target.item_id ? await repo.getItem(db, target.item_id) : await repo.getPlace(db, target.place_id!);
  if (!exists) return notFound(c);

  const id = crypto.randomUUID();
  const key = `media/${id}`;
  const sha256 = await sha256Hex(bytes);
  const now = new Date().toISOString();
  const actor = actorOf(c);

  // R2 と D1 は一体で原子的に成功しない。R2 → D1 の順に書き、D1 失敗時は R2 を消す
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  const res = await runWrite(
    c,
    () =>
      db.batch([
        db
          .prepare(
            `INSERT INTO media (id, r2_key, item_id, place_id, kind, source_url, credit, license_note,
                                reviewed_by, reviewed_at, content_type, byte_size, sha256, sort_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media WHERE item_id IS ? AND place_id IS ?), ?)`,
          )
          .bind(
            id,
            key,
            target.item_id ?? null,
            target.place_id ?? null,
            target.kind,
            target.source_url ?? null,
            target.credit ?? null,
            target.license_note ?? null,
            actor,
            now,
            contentType,
            bytes.byteLength,
            sha256,
            target.item_id ?? null,
            target.place_id ?? null,
            now,
          ),
        audit(db, c, "media", id, "create", null, ["kind", "source_url", "credit", "license_note"], now),
      ]),
    async () => {
      await c.env.MEDIA.delete(key);
    },
  );
  if (res) return res;
  return c.json({ id, content_type: contentType }, 201);
});

adminApi.patch("/media/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid" }, 400);
  }
  const status = (body as { status?: unknown })?.status;
  if (status !== "active" && status !== "hidden") return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const [, result] = await db.batch([
    audit(db, c, "media", id.data, status === "hidden" ? "hide" : "update", null, ["status"], now),
    db.prepare(`UPDATE media SET status = ? WHERE id = ?`).bind(status, id.data),
  ]);
  if ((result?.meta.changes ?? 0) === 0) return notFound(c);
  return c.body(null, 204);
});

// ---- 共通 ----

async function parseJson<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.infer<T> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function actorOf(c: Context<AppEnv>): string {
  return identityKey(c);
}

function audit(
  db: D1Database,
  c: Context<AppEnv>,
  targetType: "item" | "place" | "settings" | "media",
  targetId: string,
  action: "create" | "update" | "hide",
  versionAfter: number | null,
  changed: string[],
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_log (target_type, target_id, action, actor, version_after, changed_fields, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(targetType, targetId, action, actorOf(c), versionAfter, JSON.stringify(changed), now);
}

/** 版の一致を条件に監査ログを書く（競合時は何も書かない） */
function auditGuarded(
  db: D1Database,
  c: Context<AppEnv>,
  targetType: "item" | "place" | "settings",
  targetId: string,
  expectedVersion: number,
  changed: string[],
  now: string,
  guard: string,
  guardParams: unknown[],
) {
  return db
    .prepare(
      `INSERT INTO audit_log (target_type, target_id, action, actor, version_after, changed_fields, created_at)
       SELECT ?, ?, 'update', ?, ?, ?, ? WHERE ${guard}`,
    )
    .bind(targetType, targetId, actorOf(c), expectedVersion + 1, JSON.stringify(changed), now, ...guardParams);
}

/** DB の制約違反は 400 にする。それ以外は上位の 500 へ */
async function runWrite(c: Context<AppEnv>, write: () => Promise<unknown>, onError?: () => Promise<void>) {
  try {
    await write();
    return null;
  } catch (err) {
    if (onError) await onError().catch((e) => console.error("cleanup failed", e));
    const message = err instanceof Error ? err.message : String(err);
    if (/constraint|age bounds inconsistent/i.test(message)) {
      return c.json({ error: "invalid", detail: "データの整合性の条件を満たしていません" }, 400);
    }
    throw err;
  }
}

async function placeConflict(c: Context<AppEnv>, db: D1Database, id: string) {
  const place = await repo.getPlace(db, id);
  if (!place) return notFound(c);
  return conflict(c, place.version);
}

function conflict(c: Context<AppEnv>, currentVersion: number | undefined) {
  if (currentVersion === undefined) return notFound(c);
  return c.json(
    { error: "他の人が先に変更しました。読み込み直してから編集してください", current_version: currentVersion },
    409,
  );
}

function notFound(c: Context<AppEnv>) {
  return c.json({ error: "not found" }, 404);
}
