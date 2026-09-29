import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { httpUrlSchema } from "../../src/domain/admin";

/** config/sources.yaml（公開情報源と収集方針）。秘密情報・自宅の位置は書かない */
export const sourceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
    name: z.string().min(1),
    kind: z.enum(["municipality", "facility", "library", "childrens_center", "museum", "park", "organizer", "aggregator", "parent"]),
    urls: z.array(httpUrlSchema).default([]),
    /** 集約ページなら true（主催者の告知で日程・条件を確認する） */
    aggregator: z.boolean().default(false),
    /** 画像の扱い：none=使わない / review=親が確認してから / allowed=利用条件を確認済み */
    images: z.enum(["none", "review", "allowed"]).default("review"),
    notes: z.string().optional(),
  })
  .strict();

const fileSchema = z.object({ version: z.literal(1), sources: z.array(sourceSchema) }).strict();

export async function loadSources(path = "config/sources.yaml") {
  const parsed = fileSchema.safeParse(parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`config/sources.yaml の形式エラー: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const ids = parsed.data.sources.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`config/sources.yaml: 収集元 ID ${dup} が重複しています`);
  return parsed.data.sources;
}
