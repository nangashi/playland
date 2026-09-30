import { z } from "zod";
import { httpUrlSchema } from "../domain/admin";
import { MAX_IMAGE_BYTES, sha256Hex, sniffImageType } from "../domain/image";
import { idSchema, mediaKinds } from "../domain/model";

/**
 * 写真の取り込み。スキルが候補（画像 URL・掲載ページ・種類・出典）を挙げ、
 * 固定コードが取得・形式確認し、親が一覧で確認して採用したものだけを非公開 R2 に保存する。
 * 家族内の私的な利用として保存し、出典（掲載ページ・画像 URL・クレジット）を必ず記録する。
 */

export const photoListSchema = z
  .object({
    schema_version: z.literal(1),
    batch_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    photos: z
      .array(
        z
          .object({
            /**
             * 対象の候補。取り込み済みの候補は出典キーで、管理画面で追加した候補など出典キーのないものは
             * enrich-export の item_id で指定する
             */
            item: z.union([
              z.object({ source_id: z.string().min(1), source_key: z.string().min(1) }).strict(),
              z.object({ item_id: idSchema }).strict(),
            ]),
            image_url: httpUrlSchema,
            page_url: httpUrlSchema,
            /** venue=施設の外観・設備 / past_event=過去の様子 / image=イメージ */
            kind: z.enum(mediaKinds),
            credit: z.string().trim().min(1).max(200),
            /** 何が写っているか（親の確認用） */
            caption: z.string().trim().max(200).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();

export type PhotoList = z.infer<typeof photoListSchema>;
export type PhotoCandidate = PhotoList["photos"][number];

/** 取得結果（.local/ingest/photos/<batch>/manifest.json） */
export interface PhotoManifestEntry {
  index: number;
  status: "ok" | "error";
  error: string | null;
  file: string | null;
  content_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  candidate: PhotoCandidate;
}

export type ItemResolver = (ref: PhotoCandidate["item"]) => Promise<{ id: string; title: string } | null>;

/** 写真リストの候補の指定（出典キーか item_id）から候補を探す */
export function itemResolver(db: D1Database): ItemResolver {
  return async (ref) =>
    "item_id" in ref
      ? db.prepare(`SELECT id, title FROM items WHERE id = ?`).bind(ref.item_id).first<{ id: string; title: string }>()
      : db
          .prepare(
            `SELECT i.id, i.title FROM source_entries s JOIN items i ON i.id = s.item_id
              WHERE s.source_id = ? AND s.source_key = ?`,
          )
          .bind(ref.source_id, ref.source_key)
          .first<{ id: string; title: string }>();
}

/** 確認ページ・ログ用の候補の表示名（見つからないとき） */
export function itemRefLabel(ref: PhotoCandidate["item"]): string {
  return "item_id" in ref ? ref.item_id : ref.source_key;
}

export interface PhotoApplyOutcome {
  index: number;
  result: "saved" | "skipped_duplicate" | "skipped_not_accepted" | "error";
  media_id: string | null;
  reason: string | null;
}

export interface PhotoApplyInput {
  entry: PhotoManifestEntry;
  /** 取得したファイルの内容（採用分だけ読み込む） */
  bytes: Uint8Array | null;
}

/**
 * 親が採用した写真を保存する。
 * - 取得時から内容が変わっていないか（sha256）と形式・サイズを確かめ直す
 * - 同じ候補に同じ画像があれば保存しない（再実行で重複しない）
 * - R2 → D1 の順に書き、D1 が失敗したら R2 のファイルを消す
 */
export async function applyPhotos(
  db: D1Database,
  bucket: R2Bucket,
  inputs: readonly PhotoApplyInput[],
  accept: ReadonlySet<number>,
  options: { resolveItem: ItemResolver; now?: () => Date; newId?: () => string },
): Promise<PhotoApplyOutcome[]> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const outcomes: PhotoApplyOutcome[] = [];

  for (const { entry, bytes } of inputs) {
    const base = { index: entry.index, media_id: null };
    if (!accept.has(entry.index)) {
      outcomes.push({ ...base, result: "skipped_not_accepted", reason: null });
      continue;
    }
    if (entry.status !== "ok" || !bytes) {
      outcomes.push({ ...base, result: "error", reason: entry.error ?? "取得できていない写真です" });
      continue;
    }
    const contentType = sniffImageType(bytes);
    const sha256 = await sha256Hex(bytes);
    if (!contentType || bytes.byteLength > MAX_IMAGE_BYTES || sha256 !== entry.sha256) {
      outcomes.push({ ...base, result: "error", reason: "取得後にファイルが変わったか、形式・サイズが対象外です" });
      continue;
    }
    const item = await options.resolveItem(entry.candidate.item);
    if (!item) {
      outcomes.push({ ...base, result: "error", reason: "対応する候補が登録されていません" });
      continue;
    }
    const dup = await db
      .prepare(`SELECT id FROM media WHERE item_id = ? AND sha256 = ?`)
      .bind(item.id, sha256)
      .first<{ id: string }>();
    if (dup) {
      // 保存済みの写真に説明がなければ補う（親が入れた説明は変えない）
      if (entry.candidate.caption) {
        await db
          .prepare(`UPDATE media SET caption = ? WHERE id = ? AND caption IS NULL`)
          .bind(entry.candidate.caption, dup.id)
          .run();
      }
      outcomes.push({ index: entry.index, result: "skipped_duplicate", media_id: dup.id, reason: null });
      continue;
    }

    const id = newId();
    const key = `media/${id}`;
    const c = entry.candidate;
    const at = now().toISOString();
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO media (id, r2_key, item_id, kind, source_url, credit, caption, license_note,
                                reviewed_by, reviewed_at, content_type, byte_size, sha256, sort_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'parent', ?, ?, ?, ?,
                     (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media WHERE item_id = ?), ?)`,
          )
          .bind(
            id,
            key,
            item.id,
            c.kind,
            c.page_url,
            c.credit,
            c.caption,
            `家族内の私的な利用として保存（親が確認して採用）。画像: ${c.image_url}`,
            at,
            contentType,
            bytes.byteLength,
            sha256,
            item.id,
            at,
          ),
        db
          .prepare(
            `INSERT INTO audit_log (target_type, target_id, action, actor, version_after, changed_fields, created_at)
             VALUES ('media', ?, 'create', 'ingest-photos', NULL, ?, ?)`,
          )
          .bind(id, JSON.stringify(["kind", "source_url", "credit", "license_note"]), at),
      ]);
      outcomes.push({ index: entry.index, result: "saved", media_id: id, reason: null });
    } catch (err) {
      await bucket.delete(key).catch(() => undefined);
      outcomes.push({ ...base, result: "error", reason: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }
  }
  return outcomes;
}
