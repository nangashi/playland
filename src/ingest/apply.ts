import { validateBundle, type Bundle, type Candidate } from "./bundle";
import { loadKnown } from "./known";
import { matchCandidates, type MatchResult, type PlaceResolution } from "./match";

/**
 * 取り込みの登録。新しい候補を INSERT するだけで、既存の行を UPDATE / DELETE する経路を持たない。
 * LLM 由来の設定はここで初回だけ保存され、以後は親の編集でしか変わらない。
 */

export interface PlannedStatement {
  sql: string;
  params: unknown[];
}

/** 取り込みが書き込んでよい表（お気に入り・プロフィール・家族設定・移動・写真には書かない） */
export const INGEST_WRITABLE_TABLES = ["places", "items", "item_tags", "event_occurrences", "source_entries"] as const;

export interface PlanIds {
  itemId: string;
  placeId: string;
  sourceEntryId: string;
  occurrenceIds: string[];
}

/** 1 候補を登録する文の一覧（1 つの D1 batch = 1 トランザクションで実行する） */
export function planCandidate(
  candidate: Candidate,
  place: PlaceResolution,
  ids: PlanIds,
  batchId: string,
  now: string,
): PlannedStatement[] {
  const stmts: PlannedStatement[] = [];
  const { item, source } = candidate;
  let placeId: string | null = null;

  if (place.kind === "existing") {
    // 既存の場所は参照するだけ。住所・座標・雨天・移動設定をイベント取得の副作用で変えない
    placeId = place.id;
  } else if (place.kind === "new" && candidate.place) {
    placeId = ids.placeId;
    const p = candidate.place;
    stmts.push({
      sql: `INSERT INTO places (id, name, address_text, latitude, longitude, position_accuracy,
                                google_maps_url, initialized_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [placeId, place.name, p.address_text, p.latitude, p.longitude, p.position_accuracy, p.google_maps_url, now, now, now],
    });
  }

  stmts.push({
    sql: `INSERT INTO items (id, kind, place_id, title, child_description, rain_policy, publish_status,
                             official_url, facility_tags_status, experience_tags_status, schedule_status,
                             age_min_kind, age_min, age_max_kind, age_max, eligibility_raw_text,
                             guardian_rule, sibling_rule, recommended_age_min, recommended_age_max,
                             reservation_requirement, reservation_note, price_status, price_text,
                             initialized_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.itemId,
      item.kind,
      placeId,
      item.title,
      item.child_description,
      item.rain_policy,
      item.official_url ?? source.url,
      item.facility_tags_status,
      item.experience_tags_status,
      item.kind === "event" ? item.schedule_status : "unknown",
      item.age_min_kind,
      item.age_min,
      item.age_max_kind,
      item.age_max,
      item.eligibility_raw_text,
      item.guardian_rule,
      item.sibling_rule,
      item.recommended_age_min,
      item.recommended_age_max,
      item.reservation_requirement,
      item.reservation_note,
      item.price_status,
      item.price_text,
      now,
      now,
      now,
    ],
  });

  for (const tagId of [...new Set(item.tag_ids)]) {
    stmts.push({ sql: `INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)`, params: [ids.itemId, tagId] });
  }
  item.occurrences.forEach((o, i) => {
    stmts.push({
      sql: `INSERT INTO event_occurrences (id, item_id, start_date, end_date, starts_at, ends_at, precision, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [ids.occurrenceIds[i], ids.itemId, o.start_date, o.end_date, o.starts_at, o.ends_at, o.precision, o.status],
    });
  });

  // 出典キーの一意制約により、同じ候補の二重登録はトランザクションごと失敗する
  stmts.push({
    sql: `INSERT INTO source_entries (id, item_id, source_id, source_key, url, fetched_at, evidence,
                                      needs_review, suggested_tags, image_candidates, batch_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.sourceEntryId,
      ids.itemId,
      source.source_id,
      source.source_key,
      source.url,
      new Date(source.fetched_at).toISOString(),
      JSON.stringify(candidate.evidence),
      JSON.stringify(candidate.needs_review),
      JSON.stringify(candidate.suggested_tags),
      JSON.stringify(candidate.image_candidates),
      batchId,
      now,
    ],
  });
  return stmts;
}

export interface PreviewResult {
  batch_id: string;
  matches: MatchResult[];
  counts: Record<MatchResult["status"], number>;
}

export async function previewBundle(db: D1Database, bundle: Bundle): Promise<PreviewResult> {
  const matches = matchCandidates(bundle.candidates, await loadKnown(db));
  return { batch_id: bundle.batch_id, matches, counts: countStatuses(matches) };
}

export interface ApplyOptions {
  /** 要確認（review）のうち、親が確認して登録を認めた候補の番号 */
  accept?: ReadonlySet<number>;
  target: string;
  inputHash: string;
  now?: () => Date;
  newId?: () => string;
}

export interface ApplyOutcome {
  index: number;
  title: string;
  result: "inserted" | "skipped_existing" | "skipped_review" | "error";
  item_id: string | null;
  reason: string | null;
}

export interface ApplyResult {
  run_id: string;
  status: "completed" | "partial" | "failed";
  outcomes: ApplyOutcome[];
}

/**
 * 検証済みの登録用 JSON を登録する。preview の後に状況が変わりうるので、ここでも照合をやり直す。
 * 候補ごとに 1 トランザクションで登録し、途中で失敗しても同じ入力の再実行で残りを完了できる。
 */
export async function applyBundle(db: D1Database, raw: unknown, options: ApplyOptions): Promise<ApplyResult> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const startedAt = now().toISOString();
  const runId = newId();

  const validation = validateBundle(raw);
  if (!validation.ok || !validation.bundle) {
    throw new Error("登録用 JSON の検証に失敗しました。validate の結果を確認してください");
  }
  const bundle = validation.bundle;
  const matches = matchCandidates(bundle.candidates, await loadKnown(db));

  const outcomes: ApplyOutcome[] = [];
  for (const match of matches) {
    const candidate = bundle.candidates[match.index]!;
    const base = { index: match.index, title: match.title };
    if (match.status === "existing") {
      outcomes.push({ ...base, result: "skipped_existing", item_id: match.existing_item_id, reason: null });
      continue;
    }
    if (match.status === "error") {
      outcomes.push({ ...base, result: "error", item_id: null, reason: match.reasons.join(" / ") });
      continue;
    }
    if (match.status === "review" && !options.accept?.has(match.index)) {
      outcomes.push({ ...base, result: "skipped_review", item_id: null, reason: match.reasons.join(" / ") });
      continue;
    }
    const ids: PlanIds = {
      itemId: newId(),
      placeId: newId(),
      sourceEntryId: newId(),
      occurrenceIds: candidate.item.occurrences.map(() => newId()),
    };
    const plan = planCandidate(candidate, match.place, ids, bundle.batch_id, now().toISOString());
    try {
      await db.batch(plan.map((s) => db.prepare(s.sql).bind(...s.params)));
      outcomes.push({ ...base, result: "inserted", item_id: ids.itemId, reason: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed: source_entries/.test(message)) {
        // 他の実行が先に登録した
        outcomes.push({ ...base, result: "skipped_existing", item_id: null, reason: null });
      } else {
        outcomes.push({ ...base, result: "error", item_id: null, reason: message.slice(0, 300) });
      }
    }
  }

  const errors = outcomes.filter((o) => o.result === "error").length;
  const inserted = outcomes.filter((o) => o.result === "inserted").length;
  const status = errors === 0 ? "completed" : inserted > 0 ? "partial" : "failed";
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
      inserted,
      outcomes.filter((o) => o.result === "skipped_existing").length,
      outcomes.filter((o) => o.result === "skipped_review").length,
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

export function countStatuses(matches: readonly MatchResult[]): Record<MatchResult["status"], number> {
  const counts = { new: 0, existing: 0, review: 0, error: 0 };
  for (const m of matches) counts[m.status]++;
  return counts;
}
