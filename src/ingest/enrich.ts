import { z } from "zod";
import { httpUrlSchema } from "../domain/admin";
import {
  ageBoundKinds,
  guardianRules,
  idSchema,
  priceStatuses,
  rainPolicies,
  reservationRequirements,
  siblingRules,
  type TagCategory,
} from "../domain/model";
import { TAGS } from "../domain/tags";
import { MAX_EVIDENCE_TEXT } from "./bundle";

/**
 * 既存の候補の補足。管理画面で追加した候補など、空欄（unknown / null / タグ未判定）が残っている候補を
 * LLM が公式ページで調べて補足用 JSON を作り、固定コードが検証・差分表示・登録する。
 *
 * - 書き換えるのは「まだ空欄の項目」だけ。値が入っている項目（親の入力・取り込み時の判定）は変えない
 * - 書き出したときの版（version）と一致するときだけ登録する。途中で親が編集した候補は書き出し直す
 * - 親の確認日時（parent_reviewed_at）は変えない。根拠は source_entries に残す
 */

/** 補足の出典キーの接頭辞。通常の取り込みの出典と区別する */
export const ENRICH_SOURCE_KEY_PREFIX = "enrich:";
/** 補足が書き込んでよい表 */
export const ENRICH_WRITABLE_TABLES = ["places", "items", "item_tags", "source_entries", "audit_log"] as const;

// ---- 空欄の定義 ----

export interface ItemRow {
  id: string;
  kind: string;
  place_id: string | null;
  title: string;
  publish_status: string;
  version: number;
  child_description: string | null;
  official_url: string | null;
  rain_policy: string;
  facility_tags_status: string;
  experience_tags_status: string;
  age_min_kind: string;
  age_min: number | null;
  age_max_kind: string;
  age_max: number | null;
  eligibility_raw_text: string | null;
  guardian_rule: string;
  sibling_rule: string;
  recommended_age_min: number | null;
  recommended_age_max: number | null;
  reservation_requirement: string;
  reservation_note: string | null;
  price_status: string;
  price_text: string | null;
  place_name: string | null;
  place_address_text: string | null;
}

const ITEM_COLUMNS = `i.id, i.kind, i.place_id, i.title, i.publish_status, i.version, i.child_description, i.official_url,
  i.rain_policy, i.facility_tags_status, i.experience_tags_status, i.age_min_kind, i.age_min, i.age_max_kind, i.age_max,
  i.eligibility_raw_text, i.guardian_rule, i.sibling_rule, i.recommended_age_min, i.recommended_age_max,
  i.reservation_requirement, i.reservation_note, i.price_status, i.price_text,
  p.name AS place_name, p.address_text AS place_address_text`;

/** 補足できる項目。unknown / null のもの（タグは分類ごとに未判定のもの）だけが対象 */
const NULLABLE_COLUMNS = [
  "child_description",
  "official_url",
  "eligibility_raw_text",
  "recommended_age_min",
  "recommended_age_max",
  "reservation_note",
  "price_text",
] as const;
const UNKNOWN_COLUMNS = ["rain_policy", "guardian_rule", "sibling_rule", "reservation_requirement", "price_status"] as const;

export type EnrichField =
  | (typeof NULLABLE_COLUMNS)[number]
  | (typeof UNKNOWN_COLUMNS)[number]
  | "age_min"
  | "age_max"
  | "facility_tags"
  | "experience_tags"
  | "place.address_text";

/** 空欄の項目の一覧（書き出しと差分表示で使う） */
export function missingFields(row: ItemRow): EnrichField[] {
  const missing: EnrichField[] = [];
  for (const col of NULLABLE_COLUMNS) if (row[col] === null) missing.push(col);
  for (const col of UNKNOWN_COLUMNS) if (row[col] === "unknown") missing.push(col);
  if (row.age_min_kind === "unknown") missing.push("age_min");
  if (row.age_max_kind === "unknown") missing.push("age_max");
  if (row.facility_tags_status === "unassessed") missing.push("facility_tags");
  if (row.experience_tags_status === "unassessed") missing.push("experience_tags");
  if (row.place_id !== null && row.place_address_text === null) missing.push("place.address_text");
  return missing;
}

// ---- 書き出し ----

export interface IncompleteItem {
  item_id: string;
  /** 補足用 JSON にそのまま書く（登録時にこの版と一致するか確かめる） */
  version: number;
  title: string;
  publish_status: string;
  official_url: string | null;
  /** 通常の取り込みで登録された候補か（false なら管理画面などで追加された候補） */
  from_ingest: boolean;
  place: { id: string; name: string; address_text: string | null } | null;
  missing: EnrichField[];
  /** 表示中の写真の枚数（候補と場所の写真）。0 なら写真の候補も挙げる（photos-fetch で item_id を指定） */
  photo_count: number;
  /** 今の値（空欄でない項目を含む。調べる手がかり） */
  current: Omit<ItemRow, "id" | "kind" | "place_id" | "title" | "publish_status" | "version" | "place_name" | "place_address_text"> & {
    tag_ids: string[];
  };
}

/**
 * 空欄の残っている候補（写真がないだけの候補を含む）を書き出す。家族の情報（保存・興味なし・プロフィール・自宅）は含めない。
 * 既定では通常の取り込みを経ていない候補（管理画面で追加したもの）だけ。all で取り込み済みの候補も含める。
 */
export async function loadIncomplete(db: D1Database, options: { all?: boolean } = {}): Promise<IncompleteItem[]> {
  const [items, tags, ingested] = await Promise.all([
    db
      .prepare(
        `SELECT ${ITEM_COLUMNS},
                (SELECT COUNT(*) FROM media m
                  WHERE m.status = 'active' AND (m.item_id = i.id OR m.place_id = i.place_id)) AS photo_count
           FROM items i LEFT JOIN places p ON p.id = i.place_id
          WHERE i.kind = 'spot' AND i.publish_status != 'hidden' ORDER BY i.created_at, i.id`,
      )
      .all<ItemRow & { photo_count: number }>(),
    db.prepare(`SELECT item_id, tag_id FROM item_tags ORDER BY item_id, tag_id`).all<{ item_id: string; tag_id: string }>(),
    db
      .prepare(`SELECT DISTINCT item_id FROM source_entries WHERE item_id IS NOT NULL AND source_key NOT LIKE ?`)
      .bind(`${ENRICH_SOURCE_KEY_PREFIX}%`)
      .all<{ item_id: string }>(),
  ]);
  const tagsByItem = new Map<string, string[]>();
  for (const t of tags.results) tagsByItem.set(t.item_id, [...(tagsByItem.get(t.item_id) ?? []), t.tag_id]);
  const fromIngest = new Set(ingested.results.map((r) => r.item_id));

  return items.results.flatMap((row) => {
    const missing = missingFields(row);
    if (missing.length === 0 && row.photo_count > 0) return [];
    if (!options.all && fromIngest.has(row.id)) return [];
    const { id, kind: _kind, place_id, title, publish_status, version, place_name, place_address_text, photo_count, ...current } =
      row;
    return [
      {
        item_id: id,
        version,
        title,
        publish_status,
        official_url: row.official_url,
        from_ingest: fromIngest.has(id),
        place: place_id !== null ? { id: place_id, name: place_name ?? "", address_text: place_address_text } : null,
        missing,
        photo_count,
        current: { ...current, tag_ids: tagsByItem.get(id) ?? [] },
      },
    ];
  });
}

// ---- 補足用 JSON ----

const isoDateTime = z.iso.datetime({ offset: true });
const shortText = (max: number) => z.string().trim().min(1).max(max);
const age = z.number().int().min(0).max(120);
/** 不明（unknown）は書かない。分からない項目は省略する */
const known = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).exclude(["unknown"] as never, { error: "分からない項目は unknown にせず、省略してください" });

const itemFieldsSchema = z
  .object({
    child_description: shortText(120).optional(),
    official_url: httpUrlSchema.optional(),
    /** 分類ごとの判定結果。書いた分類は「判定済み」になる（該当なしは空配列） */
    facility_tag_ids: z.array(z.string()).max(30).optional(),
    experience_tag_ids: z.array(z.string()).max(30).optional(),
    rain_policy: known(rainPolicies).optional(),
    age_min_kind: known(ageBoundKinds).optional(),
    age_min: age.optional(),
    age_max_kind: known(ageBoundKinds).optional(),
    age_max: age.optional(),
    eligibility_raw_text: shortText(1000).optional(),
    guardian_rule: known(guardianRules).optional(),
    sibling_rule: known(siblingRules).optional(),
    recommended_age_min: age.optional(),
    recommended_age_max: age.optional(),
    reservation_requirement: known(reservationRequirements).optional(),
    reservation_note: shortText(1000).optional(),
    price_status: known(priceStatuses).optional(),
    price_text: shortText(300).optional(),
  })
  .strict();

const evidenceSchema = z
  .object({
    field: shortText(100),
    text: shortText(MAX_EVIDENCE_TEXT),
    source_url: httpUrlSchema,
  })
  .strict();

export const enrichUpdateSchema = z
  .object({
    item_id: idSchema,
    /** enrich-export の version をそのまま書く */
    version: z.number().int().min(1),
    source: z
      .object({
        /** config/sources.yaml の収集元 ID（公式ページは official-site、親が渡した URL は parent_url） */
        source_id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
        url: httpUrlSchema,
        fetched_at: isoDateTime,
      })
      .strict(),
    item: itemFieldsSchema.default({}),
    place: z.object({ address_text: shortText(300).optional() }).strict().default({}),
    evidence: z.array(evidenceSchema).max(30).default([]),
    needs_review: z.array(shortText(200)).max(20).default([]),
    suggested_tags: z.array(shortText(50)).max(10).default([]),
  })
  .strict();

export const enrichBundleSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.literal("enrich"),
    batch_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    created_at: isoDateTime,
    updates: z.array(enrichUpdateSchema).min(1).max(100),
  })
  .strict();

export type EnrichBundle = z.infer<typeof enrichBundleSchema>;
export type EnrichUpdate = z.infer<typeof enrichUpdateSchema>;

export interface EnrichIssues {
  index: number;
  item_id: string;
  errors: string[];
  warnings: string[];
}

export type EnrichValidation =
  | { ok: true; bundle: EnrichBundle; issues: EnrichIssues[] }
  | { ok: false; bundle: null; formatErrors: string[] }
  | { ok: false; bundle: EnrichBundle; issues: EnrichIssues[] };

/** 書いたら根拠が必要な項目 */
const ENRICH_EVIDENCE_RULES: { field: string; needed: (u: EnrichUpdate) => boolean; label: string }[] = [
  { field: "item.rain_policy", needed: (u) => u.item.rain_policy !== undefined, label: "雨天対応" },
  {
    field: "item.age",
    needed: (u) => u.item.age_min_kind !== undefined || u.item.age_max_kind !== undefined,
    label: "対象年齢",
  },
  {
    field: "item.eligibility",
    needed: (u) =>
      u.item.guardian_rule !== undefined || u.item.sibling_rule !== undefined || u.item.eligibility_raw_text !== undefined,
    label: "同伴・参加条件",
  },
  {
    field: "item.reservation",
    needed: (u) => u.item.reservation_requirement !== undefined || u.item.reservation_note !== undefined,
    label: "予約",
  },
  { field: "item.price", needed: (u) => u.item.price_status !== undefined || u.item.price_text !== undefined, label: "料金" },
  { field: "place.address", needed: (u) => u.place.address_text !== undefined, label: "住所" },
];

const tagCategoryOf = new Map(TAGS.map((t) => [t.id, t.category]));

/** 形式・タグ・年齢の整合・根拠を検証する（DB は見ない） */
export function validateEnrichBundle(input: unknown): EnrichValidation {
  const parsed = enrichBundleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      bundle: null,
      formatErrors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const bundle = parsed.data;
  const seen = new Set<string>();
  const issues = bundle.updates.map((u, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { item } = u;

    if (seen.has(u.item_id)) errors.push(`同じ候補（${u.item_id}）が重複しています`);
    seen.add(u.item_id);
    if (Object.keys(item).length === 0 && u.place.address_text === undefined) {
      errors.push("補足する項目がありません");
    }

    for (const [category, ids] of [
      ["facility", item.facility_tag_ids],
      ["experience", item.experience_tag_ids],
    ] as [TagCategory, string[] | undefined][]) {
      for (const tag of ids ?? []) {
        const actual = tagCategoryOf.get(tag);
        if (actual === undefined) errors.push(`未定義のタグ「${tag}」は suggested_tags に入れてください`);
        else if (actual !== category) errors.push(`タグ「${tag}」は ${actual}_tag_ids に入れてください`);
      }
    }

    for (const bound of ["min", "max"] as const) {
      const kind = item[`age_${bound}_kind`];
      const value = item[`age_${bound}`];
      if (kind === undefined && value !== undefined) errors.push(`age_${bound} には age_${bound}_kind が必要です`);
      if (kind !== undefined && (kind === "value") !== (value !== undefined)) {
        errors.push(`age_${bound}_kind と age_${bound} が一致しません`);
      }
    }
    if (item.age_min !== undefined && item.age_max !== undefined && item.age_min > item.age_max) {
      errors.push("年齢の下限が上限より大きい");
    }
    if (
      item.recommended_age_min !== undefined &&
      item.recommended_age_max !== undefined &&
      item.recommended_age_min > item.recommended_age_max
    ) {
      errors.push("おすすめ年齢の下限が上限より大きい");
    }

    const evidenceFields = new Set(u.evidence.map((e) => e.field.replace(/\[\d+\]$/, "")));
    for (const rule of ENRICH_EVIDENCE_RULES) {
      if (rule.needed(u) && !evidenceFields.has(rule.field)) {
        errors.push(`${rule.label}に根拠（evidence.field=${rule.field}）がありません。根拠がなければ省略してください`);
      }
    }

    for (const note of u.needs_review) warnings.push(`要確認: ${note}`);
    for (const tag of u.suggested_tags) warnings.push(`タグの提案: ${tag}`);
    return { index, item_id: u.item_id, errors, warnings };
  });

  const ok = issues.every((i) => i.errors.length === 0);
  return ok ? { ok: true, bundle, issues } : { ok: false, bundle, issues };
}

// ---- 差分 ----

export interface FieldChange {
  field: EnrichField;
  /** 登録する値（年齢は AgeFill、タグは ID の一覧） */
  value: unknown;
}

interface AgeFill {
  kind: string;
  value: number | null;
}

export interface KeptField {
  field: EnrichField;
  /** 今の値（空欄でないので変更しない） */
  current: unknown;
}

export interface EnrichPlan {
  index: number;
  item_id: string;
  title: string;
  /**
   * update=空欄を埋める / nothing=埋める項目がない / stale=書き出し後に変更された /
   * conflict=既存の値と矛盾する（年齢の下限 > 上限）/ not_found=候補がない
   */
  status: "update" | "nothing" | "stale" | "conflict" | "not_found";
  fills: FieldChange[];
  kept: KeptField[];
  reasons: string[];
  /** 現在の版（stale のとき、書き出し直す目安） */
  current_version: number | null;
}

async function loadItemRow(db: D1Database, itemId: string): Promise<ItemRow | null> {
  return db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN places p ON p.id = i.place_id WHERE i.id = ?`)
    .bind(itemId)
    .first<ItemRow>();
}

/** 今の DB と比べて、埋める項目と（値があるため）変えない項目に分ける */
export function planEnrich(update: EnrichUpdate, index: number, row: ItemRow | null): EnrichPlan {
  const base = { index, item_id: update.item_id, fills: [] as FieldChange[], kept: [] as KeptField[], reasons: [] as string[] };
  if (!row) return { ...base, title: "(不明)", status: "not_found", reasons: ["候補が見つかりません"], current_version: null };
  if (row.version !== update.version) {
    return {
      ...base,
      title: row.title,
      status: "stale",
      reasons: [`書き出し後に変更されています（版 ${update.version} → ${row.version}）。enrich-export からやり直してください`],
      current_version: row.version,
    };
  }
  const missing = new Set(missingFields(row));
  const { item } = update;
  const consider = (field: EnrichField, value: unknown, current: unknown) => {
    if (missing.has(field)) base.fills.push({ field, value });
    else base.kept.push({ field, current });
  };

  for (const col of [...NULLABLE_COLUMNS, ...UNKNOWN_COLUMNS]) {
    if (item[col] !== undefined) consider(col, item[col], row[col]);
  }
  for (const bound of ["min", "max"] as const) {
    const kind = item[`age_${bound}_kind`];
    if (kind !== undefined) {
      consider(
        `age_${bound}`,
        { kind, value: item[`age_${bound}`] ?? null },
        { kind: row[`age_${bound}_kind`], value: row[`age_${bound}`] },
      );
    }
  }
  if (item.facility_tag_ids !== undefined) consider("facility_tags", [...new Set(item.facility_tag_ids)], "判定済み");
  if (item.experience_tag_ids !== undefined) consider("experience_tags", [...new Set(item.experience_tag_ids)], "判定済み");
  if (update.place.address_text !== undefined) {
    if (row.place_id === null) base.reasons.push("場所が未設定のため住所は登録しません");
    else consider("place.address_text", update.place.address_text, row.place_address_text);
  }

  // 片方だけ埋めると、既存の値と合わせて下限 > 上限になることがある。登録せず親に確認してもらう
  const filled = (f: EnrichField) => base.fills.find((c) => c.field === f)?.value;
  const ageMin = (filled("age_min") as AgeFill | undefined)?.value ?? row.age_min;
  const ageMax = (filled("age_max") as AgeFill | undefined)?.value ?? row.age_max;
  const recMin = (filled("recommended_age_min") as number | undefined) ?? row.recommended_age_min;
  const recMax = (filled("recommended_age_max") as number | undefined) ?? row.recommended_age_max;
  const conflicts = [
    ...(ageMin !== null && ageMax !== null && ageMin > ageMax ? ["補足後の対象年齢の下限が上限より大きくなります"] : []),
    ...(recMin !== null && recMax !== null && recMin > recMax ? ["補足後のおすすめ年齢の下限が上限より大きくなります"] : []),
  ];
  if (conflicts.length > 0) {
    return { ...base, title: row.title, status: "conflict", reasons: [...base.reasons, ...conflicts], current_version: row.version };
  }

  if (base.fills.length === 0) base.reasons.push("空欄の項目がないため変更しません");
  return {
    ...base,
    title: row.title,
    status: base.fills.length > 0 ? "update" : "nothing",
    current_version: row.version,
  };
}

export interface EnrichPreview {
  batch_id: string;
  plans: EnrichPlan[];
}

export async function previewEnrich(db: D1Database, bundle: EnrichBundle): Promise<EnrichPreview> {
  const plans = await Promise.all(bundle.updates.map(async (u, i) => planEnrich(u, i, await loadItemRow(db, u.item_id))));
  return { batch_id: bundle.batch_id, plans };
}

// ---- 登録 ----

export interface PlannedStatement {
  sql: string;
  params: unknown[];
}

/**
 * 1 候補の補足を登録する文の一覧（1 つの D1 batch = 1 トランザクション）。
 * すべての文を「候補の版が書き出し時と同じ」ことを条件にし、最後に候補を更新して版を上げる。
 */
export function planEnrichStatements(
  update: EnrichUpdate,
  plan: EnrichPlan,
  row: ItemRow,
  ids: { sourceEntryId: string },
  batchId: string,
  now: string,
): PlannedStatement[] {
  const guard = `EXISTS (SELECT 1 FROM items WHERE id = ? AND version = ?)`;
  const guardParams = [row.id, row.version];
  const actor = `ingest:enrich:${batchId}`;
  const stmts: PlannedStatement[] = [];
  const fills = new Map(plan.fills.map((f) => [f.field, f.value]));

  const address = fills.get("place.address_text");
  if (address !== undefined && row.place_id !== null) {
    // 住所だけを、まだ空欄のときに入れる。座標・位置の出どころは変えない（座標は geocode で別に取得する）
    const placeBlank = `EXISTS (SELECT 1 FROM places WHERE id = ? AND address_text IS NULL)`;
    stmts.push({
      sql: `INSERT INTO audit_log (target_type, target_id, action, actor, version_after, changed_fields, created_at)
            SELECT 'place', ?, 'update', ?, (SELECT version + 1 FROM places WHERE id = ?), ?, ?
             WHERE ${guard} AND ${placeBlank}`,
      params: [row.place_id, actor, row.place_id, JSON.stringify(["address_text"]), now, ...guardParams, row.place_id],
    });
    stmts.push({
      sql: `UPDATE places SET address_text = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND address_text IS NULL AND ${guard}`,
      params: [address, now, row.place_id, ...guardParams],
    });
  }

  for (const field of ["facility_tags", "experience_tags"] as const) {
    const tagIds = fills.get(field) as string[] | undefined;
    for (const tagId of tagIds ?? []) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?, ? WHERE ${guard}`,
        params: [row.id, tagId, ...guardParams],
      });
    }
  }

  stmts.push({
    sql: `INSERT INTO source_entries (id, item_id, source_id, source_key, url, fetched_at, evidence,
                                      needs_review, suggested_tags, image_candidates, batch_id, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ? WHERE ${guard}`,
    params: [
      ids.sourceEntryId,
      row.id,
      update.source.source_id,
      `${ENRICH_SOURCE_KEY_PREFIX}${batchId}:${row.id}`,
      update.source.url,
      new Date(update.source.fetched_at).toISOString(),
      JSON.stringify(update.evidence),
      JSON.stringify(update.needs_review),
      JSON.stringify(update.suggested_tags),
      batchId,
      now,
      ...guardParams,
    ],
  });

  const sets: string[] = [];
  const values: unknown[] = [];
  const itemFields: string[] = [];
  for (const [field, value] of fills) {
    if (field === "place.address_text") continue;
    if (field === "age_min" || field === "age_max") {
      const v = value as AgeFill;
      sets.push(`${field}_kind = ?`, `${field} = ?`);
      values.push(v.kind, v.value);
      itemFields.push(`${field}_kind`, field);
    } else if (field === "facility_tags" || field === "experience_tags") {
      sets.push(`${field}_status = 'assessed'`);
      itemFields.push(`${field}_status`, "tag_ids");
    } else {
      sets.push(`${field} = ?`);
      values.push(value);
      itemFields.push(field);
    }
  }
  stmts.push({
    sql: `INSERT INTO audit_log (target_type, target_id, action, actor, version_after, changed_fields, created_at)
          SELECT 'item', ?, 'update', ?, ?, ?, ? WHERE ${guard}`,
    params: [row.id, actor, row.version + 1, JSON.stringify([...new Set(itemFields)]), now, ...guardParams],
  });
  // 親の確認日時（parent_reviewed_at）は変えない。LLM が埋めた値を親が確認したことにしない
  stmts.push({
    sql: `UPDATE items SET ${[...sets, "updated_at = ?", "version = version + 1"].join(", ")}
           WHERE id = ? AND version = ?`,
    params: [...values, now, ...guardParams],
  });
  return stmts;
}

export interface EnrichApplyOptions {
  /** 親が承認した番号。all ならプレビューで update のものすべて */
  accept: ReadonlySet<number> | "all";
  target: string;
  inputHash: string;
  now?: () => Date;
  newId?: () => string;
}

export interface EnrichOutcome {
  index: number;
  item_id: string;
  title: string;
  result: "updated" | "skipped_not_accepted" | "skipped_nothing" | "skipped_stale" | "skipped_conflict" | "error";
  fields: EnrichField[];
  reason: string | null;
}

export interface EnrichApplyResult {
  run_id: string;
  status: "completed" | "partial" | "failed";
  outcomes: EnrichOutcome[];
}

/**
 * 承認された補足を登録する。preview の後に状況が変わりうるので、ここでも DB と比べ直す。
 * 候補ごとに 1 トランザクション。同じ入力を再実行しても、埋まった項目は変えない。
 */
export async function applyEnrich(db: D1Database, raw: unknown, options: EnrichApplyOptions): Promise<EnrichApplyResult> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const startedAt = now().toISOString();
  const runId = newId();

  const validation = validateEnrichBundle(raw);
  if (!validation.ok || !validation.bundle) {
    throw new Error("補足用 JSON の検証に失敗しました。enrich-validate の結果を確認してください");
  }
  const bundle = validation.bundle;

  const outcomes: EnrichOutcome[] = [];
  for (const [index, update] of bundle.updates.entries()) {
    const row = await loadItemRow(db, update.item_id);
    const plan = planEnrich(update, index, row);
    const base = { index, item_id: update.item_id, title: plan.title, fields: [] as EnrichField[] };
    if (options.accept !== "all" && !options.accept.has(index)) {
      outcomes.push({ ...base, result: "skipped_not_accepted", reason: null });
      continue;
    }
    if (plan.status === "not_found") {
      outcomes.push({ ...base, result: "error", reason: plan.reasons.join(" / ") });
      continue;
    }
    if (plan.status === "stale") {
      outcomes.push({ ...base, result: "skipped_stale", reason: plan.reasons.join(" / ") });
      continue;
    }
    if (plan.status === "conflict") {
      outcomes.push({ ...base, result: "skipped_conflict", reason: plan.reasons.join(" / ") });
      continue;
    }
    if (plan.status === "nothing") {
      outcomes.push({ ...base, result: "skipped_nothing", reason: plan.reasons.join(" / ") });
      continue;
    }
    const stmts = planEnrichStatements(update, plan, row!, { sourceEntryId: newId() }, bundle.batch_id, now().toISOString());
    try {
      const results = await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
      if ((results.at(-1)?.meta.changes ?? 0) === 0) {
        outcomes.push({ ...base, result: "skipped_stale", reason: "登録の直前に候補が変更されました。enrich-export からやり直してください" });
      } else {
        outcomes.push({ ...base, result: "updated", fields: plan.fills.map((f) => f.field), reason: null });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed: source_entries/.test(message)) {
        outcomes.push({ ...base, result: "skipped_nothing", reason: "この補足は登録済みです" });
      } else {
        outcomes.push({ ...base, result: "error", reason: message.slice(0, 300) });
      }
    }
  }

  const errors = outcomes.filter((o) => o.result === "error").length;
  const updated = outcomes.filter((o) => o.result === "updated").length;
  const status = errors === 0 ? "completed" : updated > 0 ? "partial" : "failed";
  await db
    .prepare(
      `INSERT INTO import_runs (id, batch_id, input_hash, target, status, new_count, skipped_count,
                                review_count, error_count, failure_reason, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      runId,
      bundle.batch_id,
      options.inputHash,
      options.target,
      status,
      updated,
      outcomes.filter((o) => o.result !== "updated" && o.result !== "error").length,
      0,
      errors,
      errors > 0
        ? outcomes
            .filter((o) => o.result === "error")
            .map((o) => `#${o.index}: ${o.reason}`)
            .join("\n")
            .slice(0, 2000)
        : null,
      startedAt,
      now().toISOString(),
    )
    .run();
  return { run_id: runId, status, outcomes };
}
