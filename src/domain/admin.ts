import { z } from "zod";
import {
  ageBoundKinds,
  dateSchema,
  durationBases,
  guardianRules,
  idSchema,
  itemKinds,
  mediaKinds,
  modeVisibilities,
  occurrencePrecisions,
  occurrenceStatuses,
  positionAccuracies,
  priceStatuses,
  publishStatuses,
  rainPolicies,
  reservationRequirements,
  routeStatuses,
  scheduleStatuses,
  siblingRules,
  tagAssessments,
  transportModes,
} from "./model";
import { isKnownTagId } from "./tags";

/** 親の編集入力。API と画面で共有し、サーバーでも必ず検証する */

export const httpUrlSchema = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "http(s) の URL を入力してください");

const text = (max: number) => z.string().trim().max(max);
/** 空文字は「未入力＝null」として保存する（空文字と不明を混在させない） */
const optionalText = (max: number) =>
  z
    .union([text(max), z.null()])
    .transform((v) => (v === null || v === "" ? null : v))
    .optional();
const optionalUrl = z
  .union([httpUrlSchema, z.literal(""), z.null()])
  .transform((v) => (v === "" || v === null ? null : v))
  .optional();
const age = z.number().int().min(0).max(120);
const isoDateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());

export const occurrenceInputSchema = z
  .object({
    start_date: dateSchema,
    end_date: dateSchema,
    starts_at: isoDateTime.nullable().default(null),
    ends_at: isoDateTime.nullable().default(null),
    precision: z.enum(occurrencePrecisions),
    status: z.enum(occurrenceStatuses).default("scheduled"),
  })
  .superRefine((o, ctx) => {
    if (o.end_date < o.start_date) ctx.addIssue({ code: "custom", message: "終了日が開始日より前です" });
    if (o.precision === "date" && (o.starts_at || o.ends_at)) {
      ctx.addIssue({ code: "custom", message: "日付だけの開催に時刻は入れません" });
    }
    if (o.precision === "datetime" && !o.starts_at) {
      ctx.addIssue({ code: "custom", message: "時刻ありの開催には開始時刻が必要です" });
    }
    if (o.starts_at && o.ends_at && o.ends_at < o.starts_at) {
      ctx.addIssue({ code: "custom", message: "終了時刻が開始時刻より前です" });
    }
  });
export type OccurrenceInput = z.infer<typeof occurrenceInputSchema>;

export const itemPatchSchema = z
  .object({
    version: z.number().int().min(1),
    title: text(200).min(1).optional(),
    child_description: optionalText(300),
    rain_policy: z.enum(rainPolicies).optional(),
    publish_status: z.enum(publishStatuses).optional(),
    official_url: optionalUrl,
    place_id: idSchema.nullable().optional(),
    facility_tags_status: z.enum(tagAssessments).optional(),
    experience_tags_status: z.enum(tagAssessments).optional(),
    tag_ids: z
      .array(z.string().refine(isKnownTagId, "未定義のタグです"))
      .max(50)
      .transform((ids) => [...new Set(ids)])
      .optional(),
    schedule_status: z.enum(scheduleStatuses).optional(),
    occurrences: z.array(occurrenceInputSchema).max(200).optional(),
    age_min_kind: z.enum(ageBoundKinds).optional(),
    age_min: age.nullable().optional(),
    age_max_kind: z.enum(ageBoundKinds).optional(),
    age_max: age.nullable().optional(),
    eligibility_raw_text: optionalText(2000),
    guardian_rule: z.enum(guardianRules).optional(),
    sibling_rule: z.enum(siblingRules).optional(),
    recommended_age_min: age.nullable().optional(),
    recommended_age_max: age.nullable().optional(),
    reservation_requirement: z.enum(reservationRequirements).optional(),
    reservation_note: optionalText(2000),
    price_status: z.enum(priceStatuses).optional(),
    price_text: optionalText(500),
  })
  .strict();
export type ItemPatch = z.infer<typeof itemPatchSchema>;

/** items の列として直接更新できる項目（tag_ids / occurrences / version は別処理） */
export const ITEM_PATCH_COLUMNS = [
  "title",
  "child_description",
  "rain_policy",
  "publish_status",
  "official_url",
  "place_id",
  "facility_tags_status",
  "experience_tags_status",
  "schedule_status",
  "age_min_kind",
  "age_min",
  "age_max_kind",
  "age_max",
  "eligibility_raw_text",
  "guardian_rule",
  "sibling_rule",
  "recommended_age_min",
  "recommended_age_max",
  "reservation_requirement",
  "reservation_note",
  "price_status",
  "price_text",
] as const satisfies readonly (keyof ItemPatch)[];

export const itemCreateSchema = z
  .object({
    kind: z.enum(itemKinds),
    title: text(200).min(1),
    official_url: optionalUrl,
    place_id: idSchema.nullable().optional(),
    new_place_name: text(200).min(1).optional(),
  })
  .strict()
  .refine((v) => !(v.place_id && v.new_place_name), "会場は既存か新規のどちらかにしてください")
  .refine((v) => v.kind === "event" || v.place_id || v.new_place_name, "常設スポットには場所が必要です");
export type ItemCreate = z.infer<typeof itemCreateSchema>;

export const placePatchSchema = z
  .object({
    version: z.number().int().min(1),
    name: text(200).min(1).optional(),
    address_text: optionalText(300),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    position_accuracy: z.enum(positionAccuracies).optional(),
    google_place_id: optionalText(300),
    google_maps_url: optionalUrl,
  })
  .strict()
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), "緯度と経度は一緒に変更してください");
export type PlacePatch = z.infer<typeof placePatchSchema>;

export const PLACE_PATCH_COLUMNS = [
  "name",
  "address_text",
  "latitude",
  "longitude",
  "position_accuracy",
  "google_place_id",
  "google_maps_url",
] as const satisfies readonly (keyof PlacePatch)[];

const manualEstimateSchema = z.discriminatedUnion("route_status", [
  z
    .object({
      mode: z.enum(transportModes),
      route_status: z.literal("estimated"),
      minutes: z.number().int().min(1).max(1440),
      basis: z.enum(durationBases),
      walk_minutes: z.number().int().min(0).max(600).nullable().default(null),
      transfers: z.number().int().min(0).max(20).nullable().default(null),
      note: optionalText(500),
    })
    .strict(),
  z
    .object({
      mode: z.enum(transportModes),
      route_status: z.literal("no_route"),
      note: optionalText(500),
    })
    .strict(),
  // 親の値を消して未確認に戻す
  z.object({ mode: z.enum(transportModes), route_status: z.literal("clear") }).strict(),
]);
export type ManualEstimateInput = z.infer<typeof manualEstimateSchema>;

export const transportPatchSchema = z
  .object({
    version: z.number().int().min(1),
    preferences: z
      .array(
        z
          .object({
            mode: z.enum(transportModes),
            visibility: z.enum(modeVisibilities),
            note: optionalText(500),
          })
          .strict(),
      )
      .max(3)
      .optional(),
    estimates: z.array(manualEstimateSchema).max(3).optional(),
  })
  .strict();
export type TransportPatch = z.infer<typeof transportPatchSchema>;

export const settingsPatchSchema = z
  .object({
    version: z.number().int().min(1),
    origin_label: text(50).min(1).optional(),
    origin_latitude: z.number().min(-90).max(90).nullable().optional(),
    origin_longitude: z.number().min(-180).max(180).nullable().optional(),
    bicycle_max_minutes: z.number().int().min(1).max(180).optional(),
    /** 座標を変えずに出発地点の前提を変えたとき（古い所要時間を使わなくする） */
    bump_origin_version: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => (v.origin_latitude === undefined) === (v.origin_longitude === undefined),
    "緯度と経度は一緒に変更してください",
  );
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const mediaUploadFieldsSchema = z
  .object({
    item_id: idSchema.optional(),
    place_id: idSchema.optional(),
    kind: z.enum(mediaKinds),
    source_url: optionalUrl,
    credit: optionalText(200),
    license_note: optionalText(1000),
  })
  .refine((v) => (v.item_id === undefined) !== (v.place_id === undefined), "候補か場所のどちらか一方を指定してください");

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export const pinSchema = z.object({ pin: z.string().regex(/^\d{4,12}$/) }).strict();

/** 画面から送る形（変換前） */
export type ItemPatchInput = z.input<typeof itemPatchSchema>;
export type ItemCreateInput = z.input<typeof itemCreateSchema>;
export type PlacePatchInput = z.input<typeof placePatchSchema>;
export type TransportPatchInput = z.input<typeof transportPatchSchema>;
export type SettingsPatchInput = z.input<typeof settingsPatchSchema>;
export type OccurrenceInputValue = z.input<typeof occurrenceInputSchema>;
