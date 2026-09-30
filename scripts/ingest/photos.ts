import { readFile } from "node:fs/promises";
import { itemRefLabel, itemResolver, photoListSchema, stagePhotos, type PhotoList, type PhotoStageInput, type PhotoStageOutcome } from "../../src/ingest/photos";
import { safeFetchImage } from "./safe-fetch";

export async function readPhotoList(path: string): Promise<PhotoList> {
  const parsed = photoListSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`写真リストの形式エラー: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** 候補を取得して、採用待ちで R2・D1 に保存する（親は承認待ちの画面で採用を決める） */
export async function fetchAndStagePhotos(db: D1Database, bucket: R2Bucket, list: PhotoList): Promise<PhotoStageOutcome[]> {
  const resolve = itemResolver(db);
  const outcomes: PhotoStageOutcome[] = [];
  for (const [index, candidate] of list.photos.entries()) {
    const item = await resolve(candidate.item);
    const label = item?.title ?? `（未登録: ${itemRefLabel(candidate.item)}）`;
    let input: PhotoStageInput;
    if (!item) {
      input = { index, candidate, bytes: null, error: "対応する候補が登録されていません" };
    } else {
      try {
        input = { index, candidate, bytes: (await safeFetchImage(candidate.image_url)).bytes };
      } catch (err) {
        input = { index, candidate, bytes: null, error: err instanceof Error ? err.message : String(err) };
      }
      // 取得先への負荷を抑える
      await new Promise((r) => setTimeout(r, 500));
    }
    const [outcome] = await stagePhotos(db, bucket, [input], { resolveItem: resolve });
    const mark = { staged: "✓", skipped_duplicate: "=", error: "✗" }[outcome!.result];
    console.log(`${mark} #${index} ${label}${outcome!.reason ? `: ${outcome!.reason}` : ""}`);
    outcomes.push(outcome!);
  }
  return outcomes;
}
