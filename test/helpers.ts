import { env, SELF } from "cloudflare:test";

export const ORIGIN = "http://localhost";

/** 全テーブルを空にしてから架空の seed を投入する */
export async function seed() {
  const sql = (await import("../fixtures/seed.sql?raw")).default as string;
  const clear = [
    "import_runs",
    "source_entries",
    "audit_log",
    "admin_login_attempts",
    "media",
    "travel_estimates",
    "place_transport_preferences",
    "event_occurrences",
    "item_tags",
    "bookmarks",
    "items",
    "places",
  ].map((t) => `DELETE FROM ${t}`);
  const resetSettings = `UPDATE family_settings SET origin_label = '自宅', origin_latitude = NULL,
    origin_longitude = NULL, origin_version = 1, bicycle_max_minutes = 20, version = 1`;
  await env.DB.batch([...clear, resetSettings, ...splitStatements(sql)].map((s) => env.DB.prepare(s)));
}

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter((s) => s.length > 0);
}

export function get(path: string, init?: RequestInit) {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

export function send(method: "PUT" | "DELETE", path: string, headers: Record<string, string> = { Origin: ORIGIN }) {
  return SELF.fetch(`${ORIGIN}${path}`, { method, headers });
}

/** 同一オリジンからの JSON 送信 */
export function sendJson(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 親 PIN でセッションを開始し、Cookie ヘッダーを返す */
export async function parentLogin(pin = "1234"): Promise<Record<string, string>> {
  const res = await sendJson("POST", "/api/admin/session", { pin });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) throw new Error("no cookie");
  return { Cookie: cookie };
}
