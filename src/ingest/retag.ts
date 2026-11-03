import { z } from "zod";
import { idSchema, type TagCategory } from "../domain/model";
import { CATEGORIES, getTag } from "../domain/tags";
import { ENRICH_SOURCE_KEY_PREFIX } from "./enrich";

/**
 * 既存の候補のタグの付け直し（retag）。タグ再編（例：vehicles の廃止）のあとに、既存の候補のタグを
 * 増減の差分（add / remove）で書き換える。
 *
 * - 書き換えるのは item_tags と、items の version・updated_at だけ。タイトル・説明・料金・判定状況（*_tags_status）・
 *   親の確認日時（parent_reviewed_at）は変えない。通常の取り込み（INSERT のみ）と補足（空欄だけ）の意味論とは別の操作
 * - 候補は出典キー（source_id + source_key）で特定する（出典のない候補は item_id）。タイトルの照合と、
 *   書き出したときの版（version）との一致を確かめてから書く
 * - 適用済み（add がすべてあり、remove がすべてない）のエントリは「変更なし」。再実行しても何も変わらない
 */

/** 付け直しが書き込んでよい表（実行記録の import_runs は別に 1 行だけ書く） */
export const RETAG_WRITABLE_TABLES = ["items", "item_tags", "audit_log"] as const;
/** DELETE してよい表（外すタグの行だけ） */
export const RETAG_DELETABLE_TABLES = ["item_tags"] as const;

// ---- 書き出し ----

export interface RetagExportItem {
  item_id: string;
  /** 通常の取り込みの出典キー。なければ null（管理画面で追加した候補など。付け直しでは item_id で指定する） */
  source_id: string | null;
  source_key: string | null;
  /** 付け直し用 JSON にそのまま書く（適用時にこの版と一致するか確かめる） */
  version: number;
  title: string;
  kind: string;
  publish_status: string;
  place_name: string | null;
  official_url: string | null;
  child_description: string | null;
  facility_tags_status: string;
  experience_tags_status: string;
  tag_ids: string[];
  /** tag_ids のうち src/domain/tags.ts にないもの（廃止されたタグなど） */
  unknown_tag_ids: string[];
  /** 今のタグから計算したカテゴリ（CATEGORIES の id） */
  categories: string[];
}

interface ExportRow {
  id: string;
  kind: string;
  title: string;
  publish_status: string;
  version: number;
  official_url: string | null;
  child_description: string | null;
  facility_tags_status: string;
  experience_tags_status: string;
  place_name: string | null;
}

/**
 * 非表示（hidden）を除くすべての候補を、今のタグ・カテゴリ・出典キー付きで書き出す。
 * 家族の情報（保存・興味なし・プロフィール・自宅）は含めない。
 */
export async function loadRetagCandidates(db: D1Database): Promise<RetagExportItem[]> {
  const [items, tags, sources] = await Promise.all([
    db
      .prepare(
        `SELECT i.id, i.kind, i.title, i.publish_status, i.version, i.official_url, i.child_description,
                i.facility_tags_status, i.experience_tags_status, p.name AS place_name
           FROM items i LEFT JOIN places p ON p.id = i.place_id
          WHERE i.publish_status != 'hidden' ORDER BY i.created_at, i.id`,
      )
      .all<ExportRow>(),
    db.prepare(`SELECT item_id, tag_id FROM item_tags ORDER BY item_id, tag_id`).all<{ item_id: string; tag_id: string }>(),
    // 補足（enrich:）の出典は候補を指す鍵としては使わない。最初に登録した出典を使う
    db
      .prepare(
        `SELECT item_id, source_id, source_key FROM source_entries
          WHERE item_id IS NOT NULL AND source_key NOT LIKE ? ORDER BY created_at, id`,
      )
      .bind(`${ENRICH_SOURCE_KEY_PREFIX}%`)
      .all<{ item_id: string; source_id: string; source_key: string }>(),
  ]);
  const tagsByItem = new Map<string, string[]>();
  for (const t of tags.results) tagsByItem.set(t.item_id, [...(tagsByItem.get(t.item_id) ?? []), t.tag_id]);
  const sourceByItem = new Map<string, { source_id: string; source_key: string }>();
  for (const s of sources.results) if (!sourceByItem.has(s.item_id)) sourceByItem.set(s.item_id, s);

  return items.results.map((row) => {
    const tagIds = tagsByItem.get(row.id) ?? [];
    const source = sourceByItem.get(row.id);
    return {
      item_id: row.id,
      source_id: source?.source_id ?? null,
      source_key: source?.source_key ?? null,
      version: row.version,
      title: row.title,
      kind: row.kind,
      publish_status: row.publish_status,
      place_name: row.place_name,
      official_url: row.official_url,
      child_description: row.child_description,
      facility_tags_status: row.facility_tags_status,
      experience_tags_status: row.experience_tags_status,
      tag_ids: tagIds,
      unknown_tag_ids: tagIds.filter((t) => getTag(t) === undefined),
      categories: categoriesOf(tagIds).map((c) => c.id),
    };
  });
}

// ---- 付け直し用 JSON ----

const isoDateTime = z.iso.datetime({ offset: true });
const tagId = z.string().trim().min(1, { error: "空のタグは書けません" }).max(64);

export const retagEntrySchema = z
  .object({
    /** 出典キー（retag-export の source_id / source_key）。出典のない候補は代わりに item_id を書く */
    source_id: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
    source_key: z.string().trim().min(1).max(200).optional(),
    item_id: idSchema.optional(),
    /** retag-export の title をそのまま書く（取り違えの防止） */
    title: z.string().trim().min(1).max(200),
    /** retag-export の version をそのまま書く */
    version: z.number().int().min(1),
    add: z.array(tagId).max(30).default([]),
    remove: z.array(tagId).max(30).default([]),
    /** 付け直す理由（任意）。プレビューと結果ファイルに残る */
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const retagBundleSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.literal("retag"),
    batch_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    created_at: isoDateTime,
    entries: z.array(retagEntrySchema).min(1).max(500),
  })
  .strict();

export type RetagBundle = z.infer<typeof retagBundleSchema>;
export type RetagEntry = z.infer<typeof retagEntrySchema>;

export interface RetagIssues {
  index: number;
  /** 指定した候補（表示用） */
  ref: string;
  errors: string[];
  warnings: string[];
}

export type RetagValidation =
  | { ok: true; bundle: RetagBundle; issues: RetagIssues[] }
  | { ok: false; bundle: null; formatErrors: string[] }
  | { ok: false; bundle: RetagBundle; issues: RetagIssues[] };

export function refOf(entry: RetagEntry): string {
  if (entry.source_id !== undefined || entry.source_key !== undefined) {
    return `${entry.source_id ?? "?"}:${entry.source_key ?? "?"}`;
  }
  return entry.item_id ?? "?";
}

const duplicates = (values: string[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];

/**
 * 形式・タグ・指定の仕方・重複を検証する（DB は見ない）。
 * add の未定義タグはエラー、remove の未定義タグは警告（廃止したタグを外すのが目的のため）。
 */
export function validateRetagBundle(input: unknown): RetagValidation {
  const parsed = retagBundleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      bundle: null,
      formatErrors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const bundle = parsed.data;
  const seen = new Set<string>();
  const issues = bundle.entries.map((e, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const bySource = e.source_id !== undefined || e.source_key !== undefined;

    if (bySource && (e.source_id === undefined || e.source_key === undefined)) {
      errors.push("source_id と source_key は両方を書いてください");
    }
    if (bySource && e.item_id !== undefined) errors.push("候補は source_id + source_key か item_id のどちらか一方で指定してください");
    if (!bySource && e.item_id === undefined) errors.push("候補を source_id + source_key（出典のない候補は item_id）で指定してください");

    const ref = refOf(e);
    if (seen.has(ref)) errors.push(`同じ候補（${ref}）が重複しています`);
    seen.add(ref);

    if (e.add.length === 0 && e.remove.length === 0) errors.push("add と remove がどちらも空です");
    for (const t of duplicates(e.add)) errors.push(`add にタグ「${t}」が重複しています`);
    for (const t of duplicates(e.remove)) errors.push(`remove にタグ「${t}」が重複しています`);
    for (const t of new Set(e.add)) {
      if (e.remove.includes(t)) errors.push(`タグ「${t}」が add と remove の両方にあります`);
      if (getTag(t) === undefined) errors.push(`未定義のタグ「${t}」は add に入れられません（pnpm ingest tags で確認）`);
    }
    for (const t of new Set(e.remove)) {
      if (getTag(t) === undefined) warnings.push(`remove のタグ「${t}」は未定義です（廃止したタグとして外します）`);
    }
    return { index, ref, errors, warnings };
  });

  const ok = issues.every((i) => i.errors.length === 0);
  return ok ? { ok: true, bundle, issues } : { ok: false, bundle, issues };
}

// ---- 差分 ----

export function categoriesOf(tagIds: readonly string[]) {
  return CATEGORIES.filter((c) => c.tagIds.some((t) => tagIds.includes(t)));
}

export interface RetagPlan {
  index: number;
  ref: string;
  item_id: string | null;
  title: string;
  /**
   * update=タグを変える / unchanged=適用済み（add がすべてあり remove がすべてない）/
   * stale=書き出し後に候補が変更された / mismatch=タイトルが一致しない / not_found=候補がない
   */
  status: "update" | "unchanged" | "stale" | "mismatch" | "not_found";
  before: string[];
  after: string[];
  /** 実際に足すタグ・外すタグ（すでにある / ないものは含めない） */
  added: string[];
  removed: string[];
  categories_before: string[];
  categories_after: string[];
  reason: string | null;
  /** stale・mismatch・not_found の説明 */
  reasons: string[];
  /** 分類が空になるなどの注意（適用は止めない） */
  warnings: string[];
  current_version: number | null;
}

export interface RetagItemState {
  id: string;
  title: string;
  version: number;
  facility_tags_status: string;
  experience_tags_status: string;
  tag_ids: string[];
}

/** 出典キー（または item_id）から候補と今のタグを読む */
export async function loadRetagItem(db: D1Database, entry: RetagEntry): Promise<RetagItemState | null> {
  let itemId = entry.item_id ?? null;
  if (entry.source_id !== undefined && entry.source_key !== undefined) {
    const source = await db
      .prepare(`SELECT item_id FROM source_entries WHERE source_id = ? AND source_key = ?`)
      .bind(entry.source_id, entry.source_key)
      .first<{ item_id: string | null }>();
    itemId = source?.item_id ?? null;
  }
  if (itemId === null) return null;
  const row = await db
    .prepare(`SELECT id, title, version, facility_tags_status, experience_tags_status FROM items WHERE id = ?`)
    .bind(itemId)
    .first<Omit<RetagItemState, "tag_ids">>();
  if (!row) return null;
  const tags = await db
    .prepare(`SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY tag_id`)
    .bind(itemId)
    .all<{ tag_id: string }>();
  return { ...row, tag_ids: tags.results.map((t) => t.tag_id) };
}

/** タイトルの照合。前後・連続の空白と全角半角（NFKC）の違いは無視する */
export function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

const CATEGORY_LABEL: Record<TagCategory, string> = { facility: "施設分類", experience: "体験タグ" };

/** 今の DB と比べて、足すタグ・外すタグ・変更後のカテゴリを決める */
export function planRetag(entry: RetagEntry, index: number, item: RetagItemState | null): RetagPlan {
  const base = {
    index,
    ref: refOf(entry),
    reason: entry.reason ?? null,
    added: [] as string[],
    removed: [] as string[],
    warnings: [] as string[],
  };
  if (!item) {
    return {
      ...base,
      item_id: null,
      title: entry.title,
      status: "not_found",
      before: [],
      after: [],
      categories_before: [],
      categories_after: [],
      reasons: ["候補が見つかりません（出典キー・item_id を確かめ、retag-export からやり直してください）"],
      current_version: null,
    };
  }
  const before = [...item.tag_ids].sort();
  const categoriesBefore = categoriesOf(before).map((c) => c.id);
  const common = {
    ...base,
    item_id: item.id,
    title: item.title,
    before,
    categories_before: categoriesBefore,
    current_version: item.version,
  };
  if (!sameTitle(item.title, entry.title)) {
    return {
      ...common,
      status: "mismatch",
      after: before,
      categories_after: categoriesBefore,
      reasons: [`タイトルが一致しません（JSON:「${entry.title}」/ 今:「${item.title}」）。別の候補を指していないか確かめてください`],
    };
  }

  const added = [...new Set(entry.add)].filter((t) => !before.includes(t)).sort();
  const removed = [...new Set(entry.remove)].filter((t) => before.includes(t)).sort();
  if (added.length === 0 && removed.length === 0) {
    // 版より先に見る。適用後は版が上がるが、同じ JSON の再実行は「変更なし」にする
    return {
      ...common,
      status: "unchanged",
      after: before,
      categories_after: categoriesBefore,
      reasons: ["適用済みのため変更しません"],
    };
  }
  if (item.version !== entry.version) {
    return {
      ...common,
      status: "stale",
      after: before,
      categories_after: categoriesBefore,
      reasons: [`書き出し後に変更されています（版 ${entry.version} → ${item.version}）。retag-export からやり直してください`],
    };
  }

  const after = [...before.filter((t) => !removed.includes(t)), ...added].sort();
  const warnings: string[] = [];
  const removedUnknown = removed.filter((t) => getTag(t) === undefined);
  for (const category of ["facility", "experience"] as const) {
    const has = (tags: string[]) => tags.some((t) => getTag(t)?.category === category);
    if (has(after)) continue;
    if (has(before) || removedUnknown.length > 0) {
      const status = category === "facility" ? item.facility_tags_status : item.experience_tags_status;
      warnings.push(
        `${CATEGORY_LABEL[category]}が空になります（判定状況 ${category}_tags_status=${status} は変えません）。` +
          `当てはまるタグがあれば add に加えてください`,
      );
    }
  }
  return {
    ...common,
    status: "update",
    added,
    removed,
    after,
    categories_after: categoriesOf(after).map((c) => c.id),
    reasons: [],
    warnings,
  };
}

export interface RetagSummary {
  entries: number;
  update: number;
  unchanged: number;
  stale: number;
  mismatch: number;
  not_found: number;
  /** item_tags の行の増減 */
  item_tags_added: number;
  item_tags_removed: number;
}

export function summarize(plans: readonly RetagPlan[]): RetagSummary {
  const count = (s: RetagPlan["status"]) => plans.filter((p) => p.status === s).length;
  return {
    entries: plans.length,
    update: count("update"),
    unchanged: count("unchanged"),
    stale: count("stale"),
    mismatch: count("mismatch"),
    not_found: count("not_found"),
    item_tags_added: plans.reduce((n, p) => n + p.added.length, 0),
    item_tags_removed: plans.reduce((n, p) => n + p.removed.length, 0),
  };
}

export interface RetagPreview {
  batch_id: string;
  plans: RetagPlan[];
  summary: RetagSummary;
}

export async function previewRetag(db: D1Database, bundle: RetagBundle): Promise<RetagPreview> {
  const plans: RetagPlan[] = [];
  for (const [i, e] of bundle.entries.entries()) plans.push(planRetag(e, i, await loadRetagItem(db, e)));
  return { batch_id: bundle.batch_id, plans, summary: summarize(plans) };
}

// ---- 適用 ----

export interface PlannedStatement {
  sql: string;
  params: unknown[];
}

/**
 * 1 候補の付け直しの文の一覧（1 つの D1 batch = 1 トランザクション）。
 * すべての文を「候補の版が書き出し時と同じ」ことを条件にし、最後に候補の版と更新日時だけを上げる。
 */
export function planRetagStatements(plan: RetagPlan, version: number, batchId: string, now: string): PlannedStatement[] {
  const itemId = plan.item_id!;
  const guard = `EXISTS (SELECT 1 FROM items WHERE id = ? AND version = ?)`;
  const guardParams = [itemId, version];
  const stmts: PlannedStatement[] = [];
  for (const tag of plan.removed) {
    stmts.push({ sql: `DELETE FROM item_tags WHERE item_id = ? AND tag_id = ? AND ${guard}`, params: [itemId, tag, ...guardParams] });
  }
  for (const tag of plan.added) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?, ? WHERE ${guard}`,
      params: [itemId, tag, ...guardParams],
    });
  }
  stmts.push({
    sql: `INSERT INTO audit_log (target_type, target_id, action, actor, version_after, changed_fields, created_at)
          SELECT 'item', ?, 'update', ?, ?, ?, ? WHERE ${guard}`,
    params: [itemId, `ingest:retag:${batchId}`, version + 1, JSON.stringify(["tag_ids"]), now, ...guardParams],
  });
  // タグ以外の項目・判定状況・親の確認日時は変えない
  stmts.push({
    sql: `UPDATE items SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    params: [now, ...guardParams],
  });
  return stmts;
}

export interface RetagApplyOptions {
  /** 親が承認した番号。all ならすべて */
  accept: ReadonlySet<number> | "all";
  target: string;
  inputHash: string;
  now?: () => Date;
  newId?: () => string;
}

export interface RetagOutcome {
  index: number;
  ref: string;
  item_id: string | null;
  title: string;
  result: "updated" | "unchanged" | "skipped_not_accepted" | "skipped_stale" | "skipped_mismatch" | "error";
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  categories_before: string[];
  categories_after: string[];
  version_before: number | null;
  version_after: number | null;
  reason: string | null;
  /** 失敗・見送りの理由 */
  message: string | null;
  warnings: string[];
}

export interface RetagApplyResult {
  run_id: string;
  batch_id: string;
  target: string;
  input_hash: string;
  status: "completed" | "partial" | "failed";
  started_at: string;
  finished_at: string;
  outcomes: RetagOutcome[];
  summary: { updated: number; unchanged: number; not_accepted: number; stale: number; mismatch: number; error: number };
}

/** 適用しなかった（承認されたのに書けなかった）結果 */
const FAILED_RESULTS: ReadonlySet<RetagOutcome["result"]> = new Set(["skipped_stale", "skipped_mismatch", "error"]);

/**
 * 承認されたエントリのタグを付け直す。preview の後に状況が変わりうるので、ここでも DB と比べ直す。
 * 候補ごとに 1 トランザクション。同じ入力の再実行は、適用済みのエントリを「変更なし」にする。
 *
 * status: 承認したエントリがすべて適用済み・変更なし → completed、一部だけ適用できた → partial、
 * 適用できたものがなく失敗（書き出し後の変更・タイトル不一致・候補なし・DB エラー）がある → failed
 */
export async function applyRetag(db: D1Database, raw: unknown, options: RetagApplyOptions): Promise<RetagApplyResult> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const startedAt = now().toISOString();
  const runId = newId();

  const validation = validateRetagBundle(raw);
  if (!validation.ok || !validation.bundle) {
    throw new Error("付け直し用 JSON の検証に失敗しました。retag-validate の結果を確認してください");
  }
  const bundle = validation.bundle;

  const outcomes: RetagOutcome[] = [];
  for (const [index, entry] of bundle.entries.entries()) {
    const item = await loadRetagItem(db, entry);
    const plan = planRetag(entry, index, item);
    const base = {
      index,
      ref: plan.ref,
      item_id: plan.item_id,
      title: plan.title,
      before: plan.before,
      after: plan.before,
      added: [] as string[],
      removed: [] as string[],
      categories_before: plan.categories_before,
      categories_after: plan.categories_before,
      version_before: plan.current_version,
      version_after: plan.current_version,
      reason: plan.reason,
      message: plan.reasons.length > 0 ? plan.reasons.join(" / ") : null,
      warnings: [] as string[],
    };
    if (options.accept !== "all" && !options.accept.has(index)) {
      outcomes.push({ ...base, result: "skipped_not_accepted", message: null });
      continue;
    }
    if (plan.status !== "update") {
      const result = ({ not_found: "error", stale: "skipped_stale", mismatch: "skipped_mismatch", unchanged: "unchanged" } as const)[
        plan.status
      ];
      outcomes.push({ ...base, result });
      continue;
    }
    const stmts = planRetagStatements(plan, item!.version, bundle.batch_id, now().toISOString());
    try {
      const results = await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
      if ((results.at(-1)?.meta.changes ?? 0) === 0) {
        outcomes.push({
          ...base,
          result: "skipped_stale",
          message: "適用の直前に候補が変更されました。retag-export からやり直してください",
        });
      } else {
        outcomes.push({
          ...base,
          result: "updated",
          after: plan.after,
          added: plan.added,
          removed: plan.removed,
          categories_after: plan.categories_after,
          version_after: item!.version + 1,
          warnings: plan.warnings,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ ...base, result: "error", message: message.slice(0, 300) });
    }
  }

  const count = (r: RetagOutcome["result"]) => outcomes.filter((o) => o.result === r).length;
  const summary = {
    updated: count("updated"),
    unchanged: count("unchanged"),
    not_accepted: count("skipped_not_accepted"),
    stale: count("skipped_stale"),
    mismatch: count("skipped_mismatch"),
    error: count("error"),
  };
  const failures = outcomes.filter((o) => FAILED_RESULTS.has(o.result));
  const status = failures.length === 0 ? "completed" : summary.updated > 0 ? "partial" : "failed";
  const finishedAt = now().toISOString();
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
      summary.updated,
      summary.unchanged + summary.not_accepted,
      summary.stale + summary.mismatch,
      summary.error,
      failures.length > 0
        ? failures
            .map((o) => `#${o.index}: ${o.message}`)
            .join("\n")
            .slice(0, 2000)
        : null,
      startedAt,
      finishedAt,
    )
    .run();
  return {
    run_id: runId,
    batch_id: bundle.batch_id,
    target: options.target,
    input_hash: options.inputHash,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    outcomes,
    summary,
  };
}

// ---- 戻し用の入力 ----

export interface RetagUndo {
  bundle: RetagBundle | null;
  /** 戻せない（未定義のため add に入れられない）タグ */
  omitted: { index: number; ref: string; tags: string[] }[];
}

/**
 * 適用した結果から、戻し用の付け直し用 JSON を作る（add と remove を入れ替え、版は適用後のもの）。
 * 外した未定義のタグは add に入れられない（検証で拒否される）ため含めず、omitted に挙げる
 * （戻すには事前のバックアップから復元する）。
 */
export function buildUndo(original: RetagBundle, result: RetagApplyResult, createdAt: string): RetagUndo {
  const entries: RetagEntry[] = [];
  const omitted: RetagUndo["omitted"] = [];
  for (const o of result.outcomes) {
    if (o.result !== "updated") continue;
    const source = original.entries[o.index]!;
    const unknown = o.removed.filter((t) => getTag(t) === undefined);
    if (unknown.length > 0) omitted.push({ index: o.index, ref: o.ref, tags: unknown });
    const add = o.removed.filter((t) => getTag(t) !== undefined);
    const remove = o.added;
    if (add.length === 0 && remove.length === 0) continue;
    entries.push({
      ...(source.item_id !== undefined
        ? { item_id: source.item_id }
        : { source_id: source.source_id!, source_key: source.source_key! }),
      title: o.title,
      version: o.version_after!,
      add,
      remove,
      reason: `${original.batch_id} #${o.index} の取り消し${unknown.length > 0 ? `（未定義のタグ ${unknown.join(", ")} は戻せないため含めない）` : ""}`,
    });
  }
  const batchId = `undo-${original.batch_id}`.slice(0, 64);
  return {
    bundle: entries.length > 0 ? { schema_version: 1, kind: "retag", batch_id: batchId, created_at: createdAt, entries } : null,
    omitted,
  };
}
