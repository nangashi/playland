import { readFile, rm, writeFile } from "node:fs/promises";

export type Target = "local" | "production";

export interface TargetEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
}

export interface OpenedTarget {
  target: Target;
  env: TargetEnv;
  dispose: () => Promise<void>;
}

export class UsageError extends Error {}

const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";
const REMOTE_CONFIG = ".wrangler-remote.tmp.json";

export function parseTarget(value: string | undefined): Target {
  if (value === "local" || value === "production") return value;
  throw new UsageError("--target local か --target production を指定してください");
}

/** 本番への書き込みには --confirm を必須にする（エージェントは親の承認を得てから付ける） */
export function requireConfirm(target: Target, confirmed: boolean, action: string) {
  if (target === "production" && !confirmed) {
    throw new UsageError(`本番への${action}には --confirm が必要です。内容を確認し、親の承認を得てから付けてください`);
  }
}

/** wrangler.jsonc（行頭の // コメントのみ）を読む */
async function readWranglerConfig(): Promise<Record<string, unknown>> {
  const text = await readFile("wrangler.jsonc", "utf8");
  const json = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * ローカル（wrangler dev と同じ .wrangler/state）または本番（リモートバインディング）の D1・R2 を開く。
 * 本番は wrangler login の認証を使う。
 */
export async function openTarget(target: Target, options: { localState?: string } = {}): Promise<OpenedTarget> {
  const { getPlatformProxy } = await import("wrangler");
  if (target === "local") {
    // localState は wrangler の --persist-to と同じ指定（既定は .wrangler/state）
    const persist = options.localState ? { path: `${options.localState.replace(/\/$/, "")}/v3` } : true;
    const proxy = await getPlatformProxy<TargetEnv>({ configPath: "wrangler.jsonc", persist, remoteBindings: false });
    return { target, env: proxy.env, dispose: () => proxy.dispose() };
  }

  const config = await readWranglerConfig();
  const d1 = (config.d1_databases as { database_id?: string }[] | undefined)?.[0];
  if (!d1?.database_id || d1.database_id === PLACEHOLDER_DB_ID) {
    throw new UsageError("本番の D1 がまだ設定されていません（wrangler.jsonc の database_id）。docs/production.md の手順で作成してください");
  }
  // 本番の DB・バケットだけをリモートにした一時設定（Git 管理外。終了時に削除）
  const remote = {
    ...config,
    d1_databases: (config.d1_databases as object[]).map((b) => ({ ...b, remote: true })),
    r2_buckets: (config.r2_buckets as object[]).map((b) => ({ ...b, remote: true })),
  };
  await writeFile(REMOTE_CONFIG, JSON.stringify(remote, null, 2));
  try {
    const proxy = await getPlatformProxy<TargetEnv>({
      configPath: REMOTE_CONFIG,
      persist: false,
      remoteBindings: true,
      envFiles: [],
    });
    return {
      target,
      env: proxy.env,
      dispose: async () => {
        await proxy.dispose();
        await rm(REMOTE_CONFIG, { force: true });
      },
    };
  } catch (err) {
    await rm(REMOTE_CONFIG, { force: true });
    throw err;
  }
}
