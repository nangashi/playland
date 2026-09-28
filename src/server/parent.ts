import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./types";

/**
 * 親の編集権限。家族端末は Access で認証済みでも、子どもも同じ端末を使うため、
 * 編集にはアプリ内 PIN で得る短時間のセッションを必要とする。
 * プロフィール選択や画面のボタン表示は権限の根拠にしない。
 */

export const PARENT_COOKIE = "__Host-pl_parent";
export const SESSION_TTL_SECONDS = 30 * 60;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IDENTITY = 5;
const MAX_FAILURES_GLOBAL = 20;

interface SessionPayload {
  sub: string;
  exp: number;
}

/** Access の利用者ごとに PIN の試行と session を紐付ける */
export function identityKey(c: Context<AppEnv>): string {
  const identity = c.get("identity");
  return identity.mock ? "dev-mock" : (identity.email ?? "unknown");
}

function secrets(env: Env): { pin: string; key: string } | null {
  const pin = env.PARENT_PIN;
  const key = env.ADMIN_SESSION_SECRET;
  if (!pin || !/^\d{4,12}$/.test(pin) || !key || key.length < 32) return null;
  return { pin, key };
}

export type PinResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: "invalid" | "locked" | "unavailable" };

export async function verifyPinAndStartSession(c: Context<AppEnv>, pin: string): Promise<PinResult> {
  const s = secrets(c.env);
  if (!s) {
    console.error("PARENT_PIN / ADMIN_SESSION_SECRET is not configured");
    return { ok: false, reason: "unavailable" };
  }
  const who = identityKey(c);
  const now = Date.now();
  if (await isLocked(c.env.DB, who, now)) return { ok: false, reason: "locked" };

  if (!(await constantTimeEqual(pin, s.pin))) {
    await recordFailure(c.env.DB, `pin:${who}`, now);
    await recordFailure(c.env.DB, "pin:*", now);
    return { ok: false, reason: "invalid" };
  }
  await c.env.DB.prepare(`DELETE FROM admin_login_attempts WHERE key = ?`).bind(`pin:${who}`).run();

  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const token = await sign({ sub: who, exp }, s.key);
  setCookie(c, PARENT_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return { ok: true, expiresAt: new Date(exp * 1000) };
}

export function endSession(c: Context<AppEnv>) {
  deleteCookie(c, PARENT_COOKIE, { path: "/", secure: true });
}

/** 有効な親セッションなら期限を返す */
export async function readSession(c: Context<AppEnv>): Promise<Date | null> {
  const s = secrets(c.env);
  const token = getCookie(c, PARENT_COOKIE);
  if (!s || !token) return null;
  const payload = await verify(token, s.key);
  if (!payload) return null;
  if (payload.sub !== identityKey(c)) return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return new Date(payload.exp * 1000);
}

export function requireParent(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!secrets(c.env)) return c.json({ error: "unavailable" }, 503);
    const expires = await readSession(c);
    if (!expires) return c.json({ error: "parent session required" }, 401);
    return next();
  };
}

async function isLocked(db: D1Database, who: string, now: number): Promise<boolean> {
  const { results } = await db
    .prepare(`SELECT key, window_started_at, failures FROM admin_login_attempts WHERE key IN (?, ?)`)
    .bind(`pin:${who}`, "pin:*")
    .all<{ key: string; window_started_at: string; failures: number }>();
  return results.some((r) => {
    if (now - Date.parse(r.window_started_at) >= FAILURE_WINDOW_MS) return false;
    const limit = r.key === "pin:*" ? MAX_FAILURES_GLOBAL : MAX_FAILURES_PER_IDENTITY;
    return r.failures >= limit;
  });
}

async function recordFailure(db: D1Database, key: string, now: number) {
  const nowIso = new Date(now).toISOString();
  const windowStart = new Date(now - FAILURE_WINDOW_MS).toISOString();
  // 期間を過ぎた記録はリセットしてから数える
  await db
    .prepare(
      `INSERT INTO admin_login_attempts (key, window_started_at, failures) VALUES (?, ?, 1)
       ON CONFLICT (key) DO UPDATE SET
         failures = CASE WHEN window_started_at < ? THEN 1 ELSE failures + 1 END,
         window_started_at = CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END`,
    )
    .bind(key, nowIso, windowStart, windowStart)
    .run();
}

const encoder = new TextEncoder();

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sign(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(mac))}`;
}

async function verify(token: string, secret: string): Promise<SessionPayload | null> {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  let macBytes: Uint8Array;
  try {
    macBytes = fromBase64url(mac);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), macBytes, encoder.encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionPayload;
    return typeof payload.sub === "string" && typeof payload.exp === "number" ? payload : null;
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
