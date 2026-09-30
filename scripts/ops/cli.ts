/**
 * 運用コマンド。
 *
 *   pnpm ops status  --target local|production               件数を表示
 *   pnpm ops copy-to-production --confirm                     ローカルのデータ・写真を空の本番へ複製
 *   pnpm ops backup  --target production|local [--out DIR]   データ・写真を .local/backups へ書き出す
 *   pnpm ops restore <DIR> --target local                     バックアップを空の DB へ復元（本番は --confirm）
 *
 * --state <DIR> を付けると、ローカルは既定（.wrangler/state）ではなくその保存場所を使う
 * （wrangler の --persist-to と同じ。復元の確認を別の場所で行うときに使う）
 *
 * バックアップには自宅の座標など家族の情報が含まれる。Git や共有フォルダに置かない。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  copyMediaObjects,
  countRows,
  dumpDatabase,
  loadDatabase,
  mediaKeys,
  type Snapshot,
  type StoredObject,
} from "../../src/ops/transfer";
import { openTarget, parseTarget, requireConfirm, UsageError, type OpenedTarget } from "../lib/target";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    out: { type: "string" },
    confirm: { type: "boolean", default: false },
    state: { type: "string" },
  },
});
const [command, arg] = positionals;

async function main(): Promise<number> {
  switch (command) {
    case "status":
      return withTarget(parseTarget(values.target), async (t) => {
        console.table(await countRows(t.env.DB));
        return 0;
      });
    case "copy-to-production":
      return copyToProduction();
    case "backup":
      return backup();
    case "restore":
      return restore();
    default:
      console.error("使い方: pnpm ops <status|copy-to-production|backup|restore> [--target local|production] [--confirm]");
      return 2;
  }
}

async function withTarget(target: ReturnType<typeof parseTarget>, run: (t: OpenedTarget) => Promise<number>) {
  const opened = await openTarget(target, { localState: values.state });
  if (target === "production") console.log("※ 本番（production）の D1・R2 に接続しています");
  try {
    return await run(opened);
  } finally {
    await opened.dispose();
  }
}

async function readObject(bucket: R2Bucket, key: string): Promise<StoredObject | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType ?? null };
}

function progress(key: string, result: string) {
  console.log(`  ${result === "copied" ? "✓" : result === "exists" ? "=" : "✗"} ${key}`);
}

/** ローカルのデータ・写真を、空の本番へ一度だけ複製する */
async function copyToProduction(): Promise<number> {
  requireConfirm("production", values.confirm, "データの複製");
  return withTarget("local", async (local) => {
    const snapshot = await dumpDatabase(local.env.DB);
    const keys = mediaKeys(snapshot);
    console.log(`ローカル：候補 ${snapshot.tables.items.length} 件、場所 ${snapshot.tables.places.length} 件、写真 ${keys.length} 枚`);
    return withTarget("production", async (prod) => {
      // 先に本番が空であることを確かめてから、写真 → データの順に書く
      const before = await countRows(prod.env.DB);
      if (Object.values(before).some((n) => n > 0)) {
        throw new UsageError("本番の DB が空ではないため中止しました（pnpm ops status --target production で確認）");
      }
      console.log("写真を複製しています…");
      const media = await copyMediaObjects(keys, (k) => readObject(local.env.MEDIA, k), prod.env.MEDIA, progress);
      if (media.missing.length > 0) throw new Error(`ローカルに見つからない写真があります: ${media.missing.join(", ")}`);
      console.log("データを書き込んでいます…");
      const counts = await loadDatabase(prod.env.DB, snapshot);
      console.table(counts);
      console.log(`完了：写真 ${media.copied} 枚を複製（既存 ${media.exists} 枚）`);
      return 0;
    });
  });
}

async function backup(): Promise<number> {
  const target = parseTarget(values.target);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = values.out ?? join(".local", "backups", `${target}-${stamp}`);
  return withTarget(target, async (t) => {
    const snapshot = await dumpDatabase(t.env.DB);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "d1.json"), JSON.stringify(snapshot, null, 2));
    const keys = mediaKeys(snapshot);
    const missing: string[] = [];
    const types: Record<string, string | null> = {};
    for (const key of keys) {
      const obj = await readObject(t.env.MEDIA, key);
      if (!obj) {
        missing.push(key);
        continue;
      }
      const file = join(dir, key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, obj.bytes);
      types[key] = obj.contentType;
    }
    await writeFile(join(dir, "media-types.json"), JSON.stringify(types, null, 2));
    console.table(await countRows(t.env.DB));
    console.log(`${dir} に書き出しました（写真 ${keys.length - missing.length} / ${keys.length} 枚）`);
    if (missing.length) console.log(`見つからない写真: ${missing.join(", ")}`);
    console.log("※ 自宅の座標など家族の情報が含まれます。Git や共有フォルダに置かないでください。");
    return missing.length ? 1 : 0;
  });
}

async function restore(): Promise<number> {
  if (!arg) throw new UsageError("復元するバックアップのフォルダを指定してください");
  const target = parseTarget(values.target);
  requireConfirm(target, values.confirm, "復元");
  const snapshot = JSON.parse(await readFile(join(arg, "d1.json"), "utf8")) as Snapshot;
  if (snapshot.schema_version !== 1) throw new UsageError("対応していないバックアップの形式です");
  const types = JSON.parse(await readFile(join(arg, "media-types.json"), "utf8")) as Record<string, string | null>;
  return withTarget(target, async (t) => {
    const before = await countRows(t.env.DB);
    if (Object.values(before).some((n) => n > 0)) throw new UsageError("復元先の DB が空ではないため中止しました");
    const media = await copyMediaObjects(
      mediaKeys(snapshot),
      async (key) => {
        try {
          return { bytes: new Uint8Array(await readFile(join(arg, key))), contentType: types[key] ?? null };
        } catch {
          return null;
        }
      },
      t.env.MEDIA,
    );
    if (media.missing.length > 0) throw new Error(`バックアップに見つからない写真があります: ${media.missing.join(", ")}`);
    console.table(await loadDatabase(t.env.DB, snapshot));
    console.log(`復元しました（写真 ${media.copied} 枚、既存 ${media.exists} 枚）`);
    return 0;
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof UsageError ? err.message : err);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
