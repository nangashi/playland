/**
 * Cloudflare の HTTP API（api.cloudflare.com）で本番の D1・R2 を操作する。
 * 取り込み・運用のコマンドが使う範囲だけを、D1Database・R2Bucket と同じ形で提供する。
 *
 * wrangler のリモートバインディングは内部の実行環境（workerd）が自分で名前解決するため、
 * 通信がプロキシ経由に限られる環境（Claude Code のサンドボックスなど）では使えない。
 * こちらは Node の fetch だけを使うので、HTTPS プロキシ経由でも動く。認証は API トークン（CLOUDFLARE_API_TOKEN）。
 */

const API_BASE = "https://api.cloudflare.com/client/v4";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CloudflareApi {
  token: string;
  accountId: string;
  fetch?: Fetch;
}

interface ApiEnvelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result: T;
}

interface QueryResult {
  results?: Record<string, unknown>[];
  success: boolean;
  meta?: Record<string, unknown>;
}

async function call<T>(api: CloudflareApi, path: string, init: RequestInit): Promise<T> {
  const res = await (api.fetch ?? fetch)(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json", ...init.headers },
  });
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // 本文が JSON でないときは下の HTTP 状態で失敗にする
  }
  if (!res.ok || !body?.success) {
    const message = body?.errors?.map((e) => e.message).filter(Boolean).join(" / ");
    throw new Error(message || `Cloudflare API の呼び出しに失敗しました（HTTP ${res.status}）`);
  }
  return body.result;
}

/** API トークンで操作できるアカウント ID。1 つに決まらなければ CLOUDFLARE_ACCOUNT_ID で指定してもらう */
export async function resolveAccountId(token: string, fetcher?: Fetch): Promise<string> {
  const accounts = await call<{ id: string; name: string }[]>({ token, accountId: "", fetch: fetcher }, "/accounts", {
    method: "GET",
  });
  if (accounts.length !== 1) {
    throw new Error(
      `API トークンで見えるアカウントが ${accounts.length} 件あります。CLOUDFLARE_ACCOUNT_ID で指定してください`,
    );
  }
  return accounts[0]!.id;
}

// ---- D1 ----

type Param = string | number | null;

function toParam(value: unknown): Param {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`D1 にバインドできない値です（${typeof value}）`);
}

function toD1Result(r: QueryResult): D1Result {
  const meta = r.meta ?? {};
  return {
    results: r.results ?? [],
    success: r.success,
    meta: { ...meta, changes: Number(meta.changes ?? 0), last_row_id: Number(meta.last_row_id ?? 0) },
  } as unknown as D1Result;
}

class HttpStatement {
  constructor(
    private readonly db: HttpD1,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]): HttpStatement {
    return new HttpStatement(this.db, this.sql, values.map(toParam));
  }

  async all<T>(): Promise<D1Result<T>> {
    return (await this.db.query([this]))[0] as D1Result<T>;
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    return (column === undefined ? row : (row[column] ?? null)) as T | null;
  }
}

class HttpD1 {
  constructor(
    private readonly api: CloudflareApi,
    private readonly databaseId: string,
  ) {}

  prepare(sql: string): HttpStatement {
    return new HttpStatement(this, sql);
  }

  /** 複数の文を 1 回の batch で送る（D1 はまとめて 1 トランザクションで実行する） */
  async batch(statements: HttpStatement[]): Promise<D1Result[]> {
    return statements.length === 0 ? [] : this.query(statements);
  }

  async query(statements: HttpStatement[]): Promise<D1Result[]> {
    const body =
      statements.length === 1
        ? { sql: statements[0]!.sql, params: statements[0]!.params }
        : { batch: statements.map((s) => ({ sql: s.sql, params: s.params })) };
    const results = await call<QueryResult[]>(
      this.api,
      `/accounts/${this.api.accountId}/d1/database/${this.databaseId}/query`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return results.map(toD1Result);
  }
}

export function httpD1(api: CloudflareApi, databaseId: string): D1Database {
  return new HttpD1(api, databaseId) as unknown as D1Database;
}

// ---- R2 ----

function objectPath(api: CloudflareApi, bucket: string, key: string) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${API_BASE}/accounts/${api.accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encoded}`;
}

async function r2Request(api: CloudflareApi, bucket: string, key: string, init: RequestInit): Promise<Response | null> {
  const res = await (api.fetch ?? fetch)(objectPath(api, bucket, key), {
    ...init,
    headers: { Authorization: `Bearer ${api.token}`, ...init.headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 の操作に失敗しました（${init.method} ${key}・HTTP ${res.status}）`);
  return res;
}

class HttpR2 {
  constructor(
    private readonly api: CloudflareApi,
    private readonly bucket: string,
  ) {}

  async get(key: string) {
    const res = await r2Request(this.api, this.bucket, key, { method: "GET" });
    if (!res) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? undefined;
    return {
      key,
      size: bytes.byteLength,
      httpMetadata: { contentType },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }

  /** HTTP API に HEAD がないため、取得して大きさだけを返す（写真は 5MB まで） */
  async head(key: string) {
    const obj = await this.get(key);
    return obj ? { key, size: obj.size, httpMetadata: obj.httpMetadata } : null;
  }

  async put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
    const contentType = options?.httpMetadata?.contentType;
    await r2Request(this.api, this.bucket, key, {
      method: "PUT",
      body: value,
      headers: contentType ? { "Content-Type": contentType } : {},
    }).then((res) => {
      if (!res) throw new Error(`R2 のバケット ${this.bucket} が見つかりません`);
    });
    return { key, size: value.byteLength };
  }

  async delete(key: string) {
    await r2Request(this.api, this.bucket, key, { method: "DELETE" });
  }
}

export function httpR2(api: CloudflareApi, bucket: string): R2Bucket {
  return new HttpR2(api, bucket) as unknown as R2Bucket;
}
