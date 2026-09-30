import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "../../src/domain/image";
import { mediaKindLabel } from "../../src/domain/labels";
import {
  applyPhotos,
  photoListSchema,
  sourceKeyResolver,
  type PhotoList,
  type PhotoManifestEntry,
} from "../../src/ingest/photos";
import { safeFetchImage } from "./safe-fetch";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

export async function readPhotoList(path: string): Promise<PhotoList> {
  const parsed = photoListSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`写真リストの形式エラー: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

function workDir(list: PhotoList) {
  return join(".local", "ingest", "photos", list.batch_id);
}

/** 候補を取得して保存し、確認用のページ（review.html）を作る。DB と R2 には書かない */
export async function fetchPhotos(db: D1Database, list: PhotoList): Promise<{ dir: string; manifest: PhotoManifestEntry[] }> {
  const dir = workDir(list);
  await mkdir(dir, { recursive: true });
  const resolve = sourceKeyResolver(db);
  const manifest: PhotoManifestEntry[] = [];
  const titles: string[] = [];

  for (const [index, candidate] of list.photos.entries()) {
    const item = await resolve(candidate.item);
    titles.push(item?.title ?? `（未登録: ${candidate.item.source_key}）`);
    const base = { index, candidate };
    if (!item) {
      manifest.push({ ...base, status: "error", error: "対応する候補が登録されていません", file: null, content_type: null, byte_size: null, sha256: null });
      continue;
    }
    try {
      const { bytes, contentType } = await safeFetchImage(candidate.image_url);
      const file = `${String(index).padStart(3, "0")}.${EXT[contentType]}`;
      await writeFile(join(dir, file), bytes);
      manifest.push({ ...base, status: "ok", error: null, file, content_type: contentType, byte_size: bytes.byteLength, sha256: await sha256Hex(bytes) });
      console.log(`✓ #${index} ${titles[index]}（${Math.round(bytes.byteLength / 1024)}KB）`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      manifest.push({ ...base, status: "error", error: message, file: null, content_type: null, byte_size: null, sha256: null });
      console.log(`✗ #${index} ${titles[index]}: ${message}`);
    }
    // 取得先への負荷を抑える
    await new Promise((r) => setTimeout(r, 500));
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, "review.html"), reviewHtml(list, manifest, titles));
  return { dir, manifest };
}

export async function applyFetchedPhotos(
  db: D1Database,
  bucket: R2Bucket,
  list: PhotoList,
  accept: ReadonlySet<number>,
) {
  const dir = workDir(list);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as PhotoManifestEntry[];
  const inputs = await Promise.all(
    manifest.map(async (entry) => ({
      entry,
      bytes: accept.has(entry.index) && entry.file ? new Uint8Array(await readFile(join(dir, entry.file))) : null,
    })),
  );
  return applyPhotos(db, bucket, inputs, accept, { resolveItem: sourceKeyResolver(db) });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** 親が採用する写真を選ぶための一覧（ローカルで開く静的ページ） */
function reviewHtml(list: PhotoList, manifest: PhotoManifestEntry[], titles: string[]): string {
  const cards = manifest
    .map((m) => {
      const c = m.candidate;
      const img =
        m.status === "ok" && m.file
          ? `<img src="${escapeHtml(m.file)}" alt="">`
          : `<div class="err">取得できませんでした<br>${escapeHtml(m.error ?? "")}</div>`;
      return `<figure>
  <div class="no">#${m.index}</div>${img}
  <figcaption><strong>${escapeHtml(titles[m.index] ?? "")}</strong><br>
  ${escapeHtml(mediaKindLabel[c.kind])}${c.caption ? `・${escapeHtml(c.caption)}` : ""}<br>
  出典：<a href="${escapeHtml(c.page_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.credit)}</a>
  ${m.byte_size ? `・${Math.round(m.byte_size / 1024)}KB` : ""}</figcaption>
</figure>`;
    })
    .join("\n");
  const ok = manifest.filter((m) => m.status === "ok").map((m) => m.index);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>写真の確認 ${escapeHtml(list.batch_id)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#f5f6f8;color:#1f2328}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
figure{margin:0;background:#fff;border:1px solid #d9dee4;border-radius:8px;overflow:hidden;position:relative}
img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#eee}
.err{aspect-ratio:4/3;display:grid;place-items:center;text-align:center;color:#c0392b;font-size:13px;padding:8px}
figcaption{padding:8px;font-size:13px;line-height:1.5}
.no{position:absolute;left:6px;top:6px;background:#0f6e66;color:#fff;font-weight:700;padding:2px 8px;border-radius:4px}
code{background:#fff;padding:2px 6px;border:1px solid #d9dee4;border-radius:4px}
</style></head><body>
<h1>写真の確認（${escapeHtml(list.batch_id)}）</h1>
<p>家族内の私的な利用として保存します。施設の外観や遊びの特徴が分かり、採用してよい写真の番号を選んでください。</p>
<p>全部採用する場合：<code>pnpm ingest photos-apply ${escapeHtml(`.local/ingest/${list.batch_id}.json`)} --target local --accept ${ok.join(",")}</code></p>
<div class="grid">${cards}</div>
</body></html>`;
}
