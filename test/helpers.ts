import { env, SELF } from "cloudflare:test";

export const ORIGIN = "http://localhost";

/** 全テーブルを空にしてから架空の seed を投入する */
export async function seed() {
  const sql = (await import("../fixtures/seed.sql?raw")).default as string;
  const clear = ["favorites", "items", "profiles", "places"].map((t) => `DELETE FROM ${t}`);
  await env.DB.batch([...clear, ...splitStatements(sql)].map((s) => env.DB.prepare(s)));
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
