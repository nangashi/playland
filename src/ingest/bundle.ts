import { z } from "zod";
import { httpUrlSchema } from "../domain/admin";
import {
  ageBoundKinds,
  guardianRules,
  idSchema,
  mediaKinds,
  positionAccuracies,
  priceStatuses,
  rainPolicies,
  reservationRequirements,
  siblingRules,
  tagAssessments,
} from "../domain/model";
import { isKnownTagId } from "../domain/tags";

/**
 * 登録用 JSON（LLM が作り、固定コードが検証・登録する）の形。
 * 不明は unknown / null のまま出す。推測で埋めない。
 */

const isoDateTime = z.iso.datetime({ offset: true });
/** 今は常設スポットだけを受け付ける（イベントは次のフェーズ） */
const spotKind = z.literal("spot", { error: "イベント（開催日のある候補）は次のフェーズで対応します。常設スポットだけを出してください" });
const shortText = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable().default(null);
const age = z.number().int().min(0).max(120).nullable().default(null);

export const MAX_EVIDENCE_TEXT = 300;

const sourceSchema = z
  .object({
    /** config/sources.yaml の収集元 ID。親が渡した URL は parent_url */
    source_id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
    url: httpUrlSchema,
    /** 出典内で企画を識別するキー（出典側の ID、なければ 企画名＋開催日 など） */
    source_key: shortText(200),
    fetched_at: isoDateTime,
  })
  .strict();

const placeSchema = z
  .object({
    /** 既知の場所に開催する場合は ID を指定する（export-known の一覧から選ぶ） */
    existing_place_id: idSchema.nullable().default(null),
    name: nullableText(200),
    address_text: nullableText(300),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    position_accuracy: z.enum(positionAccuracies).default("unknown"),
    /** 座標の出どころ。LLM の推測は不可（parent=親の指定、source_page=元ページに記載） */
    position_source: z.enum(["parent", "source_page"]).nullable().default(null),
    google_maps_url: httpUrlSchema.nullable().default(null),
  })
  .strict();

const itemSchema = z
  .object({
    kind: spotKind,
    title: shortText(200),
    child_description: z.string().trim().max(120).nullable().default(null),
    official_url: httpUrlSchema.nullable().default(null),
    tag_ids: z.array(z.string()).max(30).default([]),
    facility_tags_status: z.enum(tagAssessments).default("unassessed"),
    experience_tags_status: z.enum(tagAssessments).default("unassessed"),
    rain_policy: z.enum(rainPolicies).default("unknown"),
    age_min_kind: z.enum(ageBoundKinds).default("unknown"),
    age_min: age,
    age_max_kind: z.enum(ageBoundKinds).default("unknown"),
    age_max: age,
    eligibility_raw_text: nullableText(1000),
    guardian_rule: z.enum(guardianRules).default("unknown"),
    sibling_rule: z.enum(siblingRules).default("unknown"),
    recommended_age_min: age,
    recommended_age_max: age,
    reservation_requirement: z.enum(reservationRequirements).default("unknown"),
    reservation_note: nullableText(1000),
    price_status: z.enum(priceStatuses).default("unknown"),
    price_text: nullableText(300),
  })
  .strict();

const evidenceSchema = z
  .object({
    /** 根拠を示す項目（item.rain_policy / item.age / item.eligibility / item.reservation / item.price など） */
    field: shortText(100),
    /** 元ページの短い引用。全文転載しない */
    text: shortText(MAX_EVIDENCE_TEXT),
    source_url: httpUrlSchema,
  })
  .strict();

const imageCandidateSchema = z
  .object({
    url: httpUrlSchema,
    page_url: httpUrlSchema,
    kind: z.enum(mediaKinds),
    credit: nullableText(200),
    license_note: nullableText(1000),
  })
  .strict();

export const candidateSchema = z
  .object({
    source: sourceSchema,
    place: placeSchema,
    item: itemSchema,
    evidence: z.array(evidenceSchema).max(30).default([]),
    image_candidates: z.array(imageCandidateSchema).max(10).default([]),
    needs_review: z.array(shortText(200)).max(20).default([]),
    /** 定義にないタグは tag_ids に入れず、ここで親に提案する */
    suggested_tags: z.array(shortText(50)).max(10).default([]),
  })
  .strict();

export const bundleSchema = z
  .object({
    schema_version: z.literal(1),
    batch_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    created_at: isoDateTime,
    candidates: z.array(candidateSchema).min(1).max(100),
  })
  .strict();

export type Bundle = z.infer<typeof bundleSchema>;
export type Candidate = z.infer<typeof candidateSchema>;

export interface CandidateIssues {
  index: number;
  title: string;
  errors: string[];
  warnings: string[];
}

export type BundleValidation =
  | { ok: true; bundle: Bundle; issues: CandidateIssues[] }
  | { ok: false; bundle: null; formatErrors: string[] }
  | { ok: false; bundle: Bundle; issues: CandidateIssues[] };

/** 判定を「不明」以外にするときに必要な根拠の項目 */
const EVIDENCE_RULES: { field: string; needed: (c: Candidate) => boolean; label: string }[] = [
  { field: "item.rain_policy", needed: (c) => c.item.rain_policy !== "unknown", label: "雨天対応" },
  {
    field: "item.age",
    needed: (c) => c.item.age_min_kind !== "unknown" || c.item.age_max_kind !== "unknown",
    label: "対象年齢",
  },
  {
    field: "item.eligibility",
    needed: (c) => c.item.guardian_rule !== "unknown" || c.item.sibling_rule !== "unknown",
    label: "同伴条件",
  },
  { field: "item.reservation", needed: (c) => c.item.reservation_requirement !== "unknown", label: "予約" },
  { field: "item.price", needed: (c) => c.item.price_status !== "unknown", label: "料金" },
];

/**
 * 形式・許可タグ・日時の整合・根拠・座標の出どころなどを検証する（DB は見ない）。
 * エラーのある候補は登録しない。警告は親の確認用。
 */
export function validateBundle(input: unknown): BundleValidation {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      bundle: null,
      formatErrors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const bundle = parsed.data;
  const seenKeys = new Set<string>();
  const issues = bundle.candidates.map((c, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { item, place } = c;

    const key = `${c.source.source_id}\u0000${c.source.source_key}`;
    if (seenKeys.has(key)) errors.push(`同じ出典キーが重複しています（${c.source.source_key}）`);
    seenKeys.add(key);

    for (const tag of item.tag_ids) {
      if (!isKnownTagId(tag)) errors.push(`未定義のタグ「${tag}」は tag_ids ではなく suggested_tags に入れてください`);
    }

    if ((place.existing_place_id === null) === (place.name === null)) {
      errors.push("場所は existing_place_id か name のどちらか一方を指定してください");
    }
    const hasCoords = place.latitude !== null || place.longitude !== null;
    if ((place.latitude === null) !== (place.longitude === null)) errors.push("緯度と経度は両方指定してください");
    if (hasCoords && place.position_source === null) {
      errors.push("座標には出どころ（position_source）が必要です。推測した座標は入れないでください");
    }
    if (!hasCoords && place.position_accuracy !== "unknown") errors.push("座標がないのに位置の精度が指定されています");
    if (place.existing_place_id && (hasCoords || place.address_text || place.google_maps_url)) {
      warnings.push("既存の場所の住所・座標は取り込みでは変更しません（親の編集で行います）");
    }

    if ((item.age_min_kind === "value") !== (item.age_min !== null)) errors.push("age_min_kind と age_min が一致しません");
    if ((item.age_max_kind === "value") !== (item.age_max !== null)) errors.push("age_max_kind と age_max が一致しません");
    if (item.age_min !== null && item.age_max !== null && item.age_min > item.age_max) errors.push("年齢の下限が上限より大きい");

    const evidenceFields = new Set(c.evidence.map((e) => e.field.replace(/\[\d+\]$/, "")));
    for (const rule of EVIDENCE_RULES) {
      if (rule.needed(c) && !evidenceFields.has(rule.field)) {
        errors.push(`${rule.label}の判定に根拠（evidence.field=${rule.field}）がありません。根拠がなければ unknown にしてください`);
      }
    }

    if (item.tag_ids.length > 0 && item.facility_tags_status === "unassessed" && item.experience_tags_status === "unassessed") {
      warnings.push("タグがあるのに判定状態が未判定のままです");
    }
    if (c.image_candidates.length > 0) {
      warnings.push("画像候補は自動では保存しません。利用条件を確認して、管理画面から追加してください");
    }
    for (const note of c.needs_review) warnings.push(`要確認: ${note}`);
    for (const tag of c.suggested_tags) warnings.push(`タグの提案: ${tag}`);

    return { index, title: item.title, errors, warnings };
  });

  const ok = issues.every((i) => i.errors.length === 0);
  return ok ? { ok: true, bundle, issues } : { ok: false, bundle, issues };
}
